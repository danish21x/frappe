# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

from __future__ import unicode_literals
import frappe
from frappe.utils import cstr, has_gravatar, cint
from frappe import _
from frappe.model.document import Document
from frappe.core.doctype.dynamic_link.dynamic_link import deduplicate_dynamic_links
from six import iteritems
from past.builtins import cmp
from frappe.model.naming import append_number_if_name_exists
from frappe.contacts.address_and_contact import set_link_title

import functools

class Contact(Document):
	def autoname(self):
		# concat first and last name
		self.name = " ".join(filter(None,
			[cstr(self.get(f)).strip() for f in ["first_name", "last_name"]]))

		if frappe.db.exists("Contact", self.name):
			self.name = append_number_if_name_exists('Contact', self.name)

		# concat party name if reqd
		for link in self.links:
			self.name = self.name + '-' + link.link_name.strip()
			break

	def validate(self):
		self.clean_numbers_and_emails()
		self.remove_duplicates()
		self.set_primary_email()
		self.set_primary_phone()
		self.validate_phone_nos()

		self.set_user()

		set_link_title(self)

		if self.email_id and not self.image:
			self.image = has_gravatar(self.email_id)

		if self.get("sync_with_google_contacts") and not self.get("google_contacts"):
			frappe.throw(_("Select Google Contacts to which contact should be synced."))

		deduplicate_dynamic_links(self)

	def on_update(self):
		self.update_primary_address_in_linked_docs()

	def update_primary_address_in_linked_docs(self):
		from frappe.model.base_document import get_controller

		for d in self.links:
			if d.link_doctype and self.flags.from_linked_document != (d.link_doctype, d.link_name):
				try:
					if hasattr(get_controller(d.link_doctype), "update_primary_contact"):
						doc = frappe.get_doc(d.link_doctype, d.link_name)
						doc.flags.pull_contact = True
						doc.update_primary_contact()
						doc.notify_update()
				except ImportError:
					pass

	def clean_numbers_and_emails(self):
		self.mobile_no = cstr(self.mobile_no).strip()
		self.mobile_no_2 = cstr(self.mobile_no_2).strip()
		self.phone = cstr(self.phone).strip()
		self.email_id = cstr(self.email_id).strip()

		for d in self.email_ids:
			d.email_id = cstr(d.email_id).strip()
		for d in self.phone_nos:
			d.phone = cstr(d.phone).strip()

	def remove_duplicates(self):
		email_ids_visited = []
		phone_nos_visited = []
		to_remove = []

		for d in self.email_ids:
			if d.email_id in email_ids_visited:
				to_remove.append(d)
			else:
				email_ids_visited.append(d.email_id)

		for d in self.phone_nos:
			if d.phone in phone_nos_visited:
				to_remove.append(d)
			else:
				phone_nos_visited.append(d.phone)

		for d in to_remove:
			self.remove(d)

		for i, d in enumerate(self.email_ids):
			d.idx = i + 1
		for i, d in enumerate(self.phone_nos):
			d.idx = i + 1

	def validate_phone_nos(self):
		pass
		# for d in self.phone_nos:
		# 	if not d.get('is_primary_phone') and not d.get('is_primary_mobile_no'):
		# 		frappe.throw(_("Row #{0}: Please mark contact number {1} as either a Mobile Number or a Phone Number")
		# 			.format(d.idx, frappe.bold(d.phone)))

	def set_primary_email(self):
		if self.email_id:
			if self.email_id not in [d.email_id for d in self.email_ids]:
				self.append('email_ids', {'email_id': self.email_id})
		else:
			if self.email_ids:
				self.email_id = self.email_ids[0].email_id

		for d in self.email_ids:
			d.is_primary = 1 if d.email_id == self.email_id else 0

	def set_primary_phone(self):
		# secondary without primary
		if not self.mobile_no and self.mobile_no_2:
			self.mobile_no = self.mobile_no_2
			self.mobile_no_2 = ""

		# no duplicate
		if self.mobile_no == self.mobile_no_2:
			self.mobile_no_2 = ""

		all_nos = [d.phone for d in self.phone_nos]
		mobile_nos = [d.phone for d in self.phone_nos if d.is_primary_mobile_no]
		phone_nos = [d.phone for d in self.phone_nos if d.is_primary_phone]

		if self.mobile_no:
			if self.mobile_no not in all_nos:
				self.append('phone_nos', {'phone': self.mobile_no, 'is_primary_mobile_no': 1})
		else:
			if mobile_nos:
				self.mobile_no = mobile_nos[0]

		non_primary_mobile_nos = [d.phone for d in self.phone_nos if d.is_primary_mobile_no and d.phone != self.mobile_no]
		if self.mobile_no_2:
			if self.mobile_no_2 not in all_nos:
				self.append('phone_nos', {'phone': self.mobile_no_2, 'is_primary_mobile_no': 1})
		else:
			if non_primary_mobile_nos:
				self.mobile_no_2 = non_primary_mobile_nos[0]

		if self.phone:
			if self.phone not in all_nos:
				self.append('phone_nos', {'phone': self.phone, 'is_primary_phone': 1})
		else:
			if phone_nos:
				self.phone = phone_nos[0]

		for d in self.phone_nos:
			if d.phone in (self.mobile_no, self.mobile_no_2):
				d.is_primary_mobile_no = 1
			if d.phone == self.phone:
				d.is_primary_phone = 1

	def add_email(self, email_id, is_primary=0, autosave=False):
		if is_primary:
			self.email_id = email_id

		self.append("email_ids", {
			"email_id": email_id,
			"is_primary": is_primary
		})

		if autosave:
			self.save(ignore_permissions=True)

	def add_phone(self, phone, is_primary_phone=0, is_primary_mobile_no=0, autosave=False):
		self.append("phone_nos", {
			"phone": phone,
			"is_primary_phone": is_primary_phone,
			"is_primary_mobile_no": is_primary_mobile_no
		})

		if autosave:
			self.save(ignore_permissions=True)

	def set_user(self):
		if not self.user and self.email_id:
			self.user = frappe.db.get_value("User", {"email": self.email_id})

	def get_link_for(self, link_doctype):
		'''Return the link name, if exists for the given link DocType'''
		for link in self.links:
			if link.link_doctype==link_doctype:
				return link.link_name

		return None

	def has_link(self, doctype, name):
		for link in self.links:
			if link.link_doctype==doctype and link.link_name== name:
				return True

	def has_common_link(self, doc):
		reference_links = [(link.link_doctype, link.link_name) for link in doc.links]
		for link in self.links:
			if (link.link_doctype, link.link_name) in reference_links:
				return True


def get_default_contact(doctype, name, is_primary=None):
	'''Returns default contact for the given doctype, name'''
	out = frappe.db.sql('''select parent,
			IFNULL((select is_primary_contact from tabContact c where c.name = dl.parent), 0)
				as is_primary_contact
		from
			`tabDynamic Link` dl
		where
			dl.link_doctype=%s and
			dl.link_name=%s and
			dl.parenttype = "Contact"''', (doctype, name))

	if is_primary is not None:
		out = [d for d in out if d[1] == cint(is_primary)]

	if out:
		return sorted(out, key = functools.cmp_to_key(lambda x,y: cmp(cint(y[1]), cint(x[1]))))[0][0]
	else:
		return None


@frappe.whitelist()
def invite_user(contact):
	contact = frappe.get_doc("Contact", contact)

	if not contact.email_id:
		frappe.throw(_("Please set Email Address"))

	if contact.has_permission("write"):
		user = frappe.get_doc({
			"doctype": "User",
			"first_name": contact.first_name,
			"last_name": contact.last_name,
			"email": contact.email_id,
			"user_type": "Website User",
			"send_welcome_email": 1
		}).insert(ignore_permissions = True)

		return user.name


@frappe.whitelist()
def get_contact_details(contact, get_contact_no_list=False, link_doctype=None, link_name=None):
	contact = frappe.get_doc("Contact", contact) if contact else frappe._dict()
	out = frappe._dict({
		"contact_person": contact.get("name"),
		"contact_display": " ".join(filter(None,
			[contact.get("salutation"), contact.get("first_name"), contact.get("last_name")])),
		"contact_email": contact.get("email_id"),
		"contact_mobile": contact.get("mobile_no"),
		"contact_mobile_2": contact.get("mobile_no_2"),
		"contact_phone": contact.get("phone"),
		"contact_designation": contact.get("designation"),
		"contact_department": contact.get("department"),
		"contact_cnic": contact.get("tax_cnic")
	})

	if cint(get_contact_no_list) and link_doctype and link_name:
		out.contact_nos = get_all_contact_nos(link_doctype, link_name)

	return out


def update_contact(doc, method):
	'''Update contact when user is updated, if contact is found. Called via hooks'''
	contact_name = frappe.db.get_value("Contact", {"email_id": doc.name})
	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		for key in ("first_name", "last_name", "phone"):
			if doc.get(key):
				contact.set(key, doc.get(key))
		contact.flags.ignore_mandatory = True
		contact.save(ignore_permissions=True)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def contact_query(doctype, txt, searchfield, start, page_len, filters):
	from frappe.desk.reportview import get_match_cond

	if not frappe.get_meta("Contact").get_field(searchfield)\
		and searchfield not in frappe.db.DEFAULT_COLUMNS:
		return []

	link_doctype = filters.pop('link_doctype')
	link_name = filters.pop('link_name')

	return frappe.db.sql("""select
			`tabContact`.name, `tabContact`.first_name, `tabContact`.last_name,
			`tabContact`.email_id, `tabContact`.mobile_no, `tabContact`.mobile_no_2, `tabContact`.phone
		from
			`tabContact`, `tabDynamic Link`
		where
			`tabDynamic Link`.parent = `tabContact`.name and
			`tabDynamic Link`.parenttype = 'Contact' and
			`tabDynamic Link`.link_doctype = %(link_doctype)s and
			`tabDynamic Link`.link_name = %(link_name)s and
			`tabContact`.`{key}` like %(txt)s
			{mcond}
		order by
			if(locate(%(_txt)s, `tabContact`.name), locate(%(_txt)s, `tabContact`.name), 99999),
			`tabContact`.is_primary_contact desc, `tabContact`.idx desc, `tabContact`.name
		limit %(start)s, %(page_len)s """.format(mcond=get_match_cond(doctype), key=searchfield), {
			'txt': '%' + txt + '%',
			'_txt': txt.replace("%", ""),
			'start': start,
			'page_len': page_len,
			'link_name': link_name,
			'link_doctype': link_doctype
		})


@frappe.whitelist()
def address_query(links):
	import json

	links = [{"link_doctype": d.get("link_doctype"), "link_name": d.get("link_name")} for d in json.loads(links)]
	result = []

	for link in links:
		if not frappe.has_permission(doctype=link.get("link_doctype"), ptype="read", doc=link.get("link_name")):
			continue

		res = frappe.db.sql("""
			SELECT `tabAddress`.name
			FROM `tabAddress`, `tabDynamic Link`
			WHERE `tabDynamic Link`.parenttype='Address'
				AND `tabDynamic Link`.parent=`tabAddress`.name
				AND `tabDynamic Link`.link_doctype = %(link_doctype)s
				AND `tabDynamic Link`.link_name = %(link_name)s
		""", {
			"link_doctype": link.get("link_doctype"),
			"link_name": link.get("link_name"),
		}, as_dict=True)

		result.extend([l.name for l in res])

	return result


def get_contact_with_phone_number(number):
	if not number: return

	contacts = frappe.get_all('Contact Phone', filters=[
		['phone', 'like', '%{0}'.format(number)]
	], fields=["parent"], limit=1)

	return contacts[0].parent if contacts else None


def get_contact_name(email_id):
	contact = frappe.get_list("Contact Email", filters={"email_id": email_id}, fields=["parent"], limit=1)
	return contact[0].parent if contact else None


@frappe.whitelist()
def get_all_contact_nos(link_doctype, link_name):
	if not link_doctype or not link_name:
		return []

	numbers = frappe.db.sql("""
		select p.phone, p.is_primary_mobile_no, p.is_primary_phone, c.name as contact
		from `tabContact Phone` p
		inner join `tabContact` c on c.name = p.parent
		where exists(select dl.name from `tabDynamic Link` dl
			where dl.parenttype = 'Contact' and dl.parent = c.name and dl.link_doctype = %s and dl.link_name = %s)
		order by c.is_primary_contact desc, c.creation, p.idx
	""", (link_doctype, link_name), as_dict=1)

	return numbers


@frappe.whitelist()
def add_phone_no_to_contact(contact, phone, is_primary_mobile_no=0, is_primary_phone=0):
	doc = frappe.get_doc("Contact", contact)
	doc.add_phone(phone, is_primary_mobile_no=cint(is_primary_mobile_no), is_primary_phone=cint(is_primary_phone))
	doc.save()
