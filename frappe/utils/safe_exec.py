
import os, json, inspect
import mimetypes
from html2text import html2text
from RestrictedPython import compile_restricted, safe_globals
import RestrictedPython.Guards
import frappe
import frappe.utils
import frappe.utils.data
from frappe.website.utils import (get_shade, get_toc, get_next_link)
from frappe.modules import scrub
from frappe.www.printview import get_visible_columns
import frappe.exceptions
from collections import OrderedDict
import datetime

class ServerScriptNotEnabled(frappe.PermissionError): pass

def safe_exec(script, _globals=None, _locals=None):
	# script reports must be enabled via site_config.json
	if not frappe.conf.server_script_enabled:
		frappe.msgprint('Please Enable Server Scripts')
		raise ServerScriptNotEnabled

	# build globals
	exec_globals = get_safe_globals()
	if _globals:
		exec_globals.update(_globals)

	# execute script compiled by RestrictedPython
	exec(compile_restricted(script), exec_globals, _locals) # pylint: disable=exec-used

def get_safe_globals():
	datautils = frappe._dict()
	if frappe.db:
		date_format = frappe.db.get_default("date_format") or "yyyy-mm-dd"
	else:
		date_format = 'yyyy-mm-dd'

	add_data_utils(datautils)

	if "_" in getattr(frappe.local, 'form_dict', {}):
		del frappe.local.form_dict["_"]

	user = getattr(frappe.local, "session", None) and frappe.local.session.user or "Guest"

	out = frappe._dict(
		# make available limited methods of frappe
		json = json,
		dict = dict,
		tuple = tuple,
		len = len,
		abs = abs,
		datetime = datetime,
		enumerate = enumerate,
		isinstance = isinstance,
		OrderedDict = OrderedDict,
		frappe =  frappe._dict(
			flags = frappe._dict(),

			format = frappe.format_value,
			format_value = frappe.format_value,
			date_format = date_format,
			format_date = frappe.utils.data.global_date_format,
			form_dict = getattr(frappe.local, 'form_dict', {}),

			get_meta = frappe.get_meta,
			get_doc = frappe.get_doc,
			get_cached_doc = frappe.get_cached_doc,
			get_cached_value = frappe.get_cached_value,
			get_list = frappe.get_list,
			get_all = frappe.get_all,
			get_system_settings = frappe.get_system_settings,

			utils = datautils,
			get_url = frappe.utils.get_url,
			render_template = frappe.render_template,
			msgprint = frappe.msgprint,
			sendmail = frappe.sendmail,
			get_print = frappe.get_print,
			attach_print = frappe.attach_print,

			user = user,
			get_fullname = frappe.utils.get_fullname,
			get_gravatar = frappe.utils.get_gravatar_url,
			full_name = frappe.local.session.data.full_name if getattr(frappe.local, "session", None) else "Guest",
			request = getattr(frappe.local, 'request', {}),
			session = frappe._dict(
				user = user,
				csrf_token = frappe.local.session.data.csrf_token if getattr(frappe.local, "session", None) else ''
			),
			socketio_port = frappe.conf.socketio_port,
			get_hooks = frappe.get_hooks,

			original_name = frappe.utils.original_name,
			list_original_names = frappe.utils.list_original_names,

			throw = frappe.throw,
			bold = frappe.bold,
		),
		style = frappe._dict(
			border_color = '#d1d8dd'
		),
		get_toc =  get_toc,
		get_next_link = get_next_link,
		_ =  frappe._,
		_dict = frappe._dict,
		get_shade = get_shade,
		scrub =  scrub,
		guess_mimetype = mimetypes.guess_type,
		html2text = html2text,
		dev_server =  1 if os.environ.get('DEV_SERVER', False) else 0
	)

	add_module_properties(frappe.exceptions, out.frappe, lambda obj: inspect.isclass(obj) and issubclass(obj, Exception))

	if not frappe.flags.in_setup_help:
		out.get_visible_columns = get_visible_columns
		out.frappe.date_format = date_format
		out.frappe.db = frappe._dict(
			get_list = frappe.get_list,
			get_all = frappe.get_all,
			get_value = frappe.db.get_value,
			set_value = frappe.db.set_value,
			get_single_value = frappe.db.get_single_value,
			get_default = frappe.db.get_default,
			escape = frappe.db.escape,
		)

	if frappe.response:
		out.frappe.response = frappe.response

	out.update(safe_globals)

	# default writer allows write access
	out._write_ = _write
	out._getitem_ = _getitem
	out._getattr_ = getattr

	# allow iterators and list comprehension
	out._getiter_ = iter
	out._iter_unpack_sequence_ = RestrictedPython.Guards.guarded_iter_unpack_sequence
	out.sorted = sorted

	return out

def _getitem(obj, key):
	# guard function for RestrictedPython
	# allow any key to be accessed as long as it does not start with underscore
	if isinstance(key, str) and key.startswith('_'):
		raise SyntaxError('Key starts with _')
	return obj[key]

def _write(obj):
	# guard function for RestrictedPython
	# allow writing to any object
	return obj

def add_data_utils(data):
	for key, obj in frappe.utils.data.__dict__.items():
		if key in VALID_UTILS:
			data[key] = obj

def add_module_properties(module, data, filter_method):
	for key, obj in module.__dict__.items():
		if key.startswith("_"):
			# ignore
			continue

		if filter_method(obj):
			# only allow functions
			data[key] = obj

VALID_UTILS = (
"DATE_FORMAT",
"TIME_FORMAT",
"DATETIME_FORMAT",
"is_invalid_date_string",
"getdate",
"combine_datetime",
"get_datetime",
"to_timedelta",
"add_to_date",
"add_days",
"add_months",
"add_years",
"date_diff",
"month_diff",
"time_diff",
"time_diff_in_seconds",
"time_diff_in_hours",
"now_datetime",
"get_timestamp",
"get_eta",
"get_time_zone",
"convert_utc_to_user_timezone",
"now",
"nowdate",
"today",
"nowtime",
"get_first_day",
"get_quarter_start",
"get_first_day_of_week",
"get_year_start",
"get_last_day_of_week",
"get_last_day",
"get_time",
"get_datetime_str",
"get_date_str",
"get_time_str",
"get_user_date_format",
"get_user_time_format",
"formatdate",
"format_time",
"format_datetime",
"format_duration",
"get_weekdays",
"get_weekday",
"get_timespan_date_range",
"global_date_format",
"has_common",
"flt",
"cint",
"floor",
"ceil",
"cstr",
"rounded",
"remainder",
"safe_div",
"round_based_on_smallest_currency_fraction",
"encode",
"parse_val",
"fmt_money",
"get_number_format_info",
"money_in_words",
"in_words",
"is_html",
"is_image",
"get_thumbnail_base64_for_image",
"image_to_base64",
"strip_html",
"escape_html",
"pretty_date",
"comma_or",
"comma_and",
"comma_sep",
"new_line_sep",
"filter_strip_join",
"get_url",
"get_host_name_from_request",
"url_contains_port",
"get_host_name",
"get_link_to_form",
"get_link_to_report",
"get_absolute_url",
"get_url_to_form",
"get_url_to_list",
"get_url_to_report",
"get_url_to_report_with_filters",
"evaluate_filters",
"compare",
"get_filter",
"make_filter_tuple",
"make_filter_dict",
"sanitize_column",
"scrub_urls",
"expand_relative_urls",
"quoted",
"quote_urls",
"unique",
"strip",
"to_markdown",
"md_to_html",
"is_subset",
"generate_hash"
)