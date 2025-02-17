// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt

import GridRow from "./grid_row";

frappe.ui.form.get_open_grid_form = function() {
	return $(".grid-row-open").data("grid_row");
}

frappe.ui.form.close_grid_form = function() {
	var open_form = frappe.ui.form.get_open_grid_form();
	open_form && open_form.hide_form();

	// hide editable row too
	if(frappe.ui.form.editable_row) {
		frappe.ui.form.editable_row.toggle_editable_row(false);
	}
}


export default class Grid {
	constructor(opts) {
		$.extend(this, opts);
		this.fieldinfo = {};
		this.doctype = this.df.options;

		if(this.doctype) {
			this.meta = frappe.get_meta(this.doctype);
		}
		this.fields_map = {};
		this.template = null;
		this.multiple_set = false;
		if(this.frm && this.frm.meta.__form_grid_templates
			&& this.frm.meta.__form_grid_templates[this.df.fieldname]) {
			this.template = this.frm.meta.__form_grid_templates[this.df.fieldname];
		}

		this.is_grid = true;
	}

	allow_on_grid_editing() {
		if(frappe.utils.is_xs()) {
			return false;
		} else if(this.meta && this.meta.editable_grid || !this.meta) {
			return true;
		} else {
			return false;
		}
	}
	make() {
		var me = this;

		let template = `<div class="form-group">
			<div class="clearfix">
				<label class="control-label" style="padding-right: 0px;">${__(this.df.label || '')}</label>
			</div>
			<div class="form-grid">
				<div class="grid-heading-row"></div>
				<div class="grid-body">
					<div class="rows"></div>
					<div class="grid-empty text-center">${__("No Data")}</div>
				</div>
			</div>
			<div class="small form-clickable-section grid-footer">
				<div class="row">
					<div class="col-sm-8 grid-buttons">
						<button class="btn btn-xs btn-danger grid-remove-rows hidden"
							style="margin-right: 4px;">
							${__("Delete")}</button>
						<!-- hack to allow firefox include this in tabs -->
						<button class="btn btn-xs btn-default grid-add-row">
							${__("Add Row")}</button>
						<button class="grid-add-multiple-rows btn btn-xs btn-default hidden"
							style="margin-right: 4px;">
							${__("Add Multiple")}</a>
					</div>
					<div class="col-sm-4 text-right">
						<a href="#" class="grid-download btn btn-xs btn-default hidden"
							style="margin-left: 10px;">
							${__("Download")}</a>
						<a href="#" class="grid-upload btn btn-xs btn-default hidden"
							style="margin-left: 10px;">
							${__("Upload")}</a>
					</div>
				</div>
			</div>
		</div>`;

		this.wrapper = $(template)
			.appendTo(this.parent)
			.attr("data-fieldname", this.df.fieldname);

		this.form_grid = this.wrapper.find('.form-grid');

		this.wrapper.find(".grid-add-row").click(function() {
			me.add_new_row(null, null, true);
			me.set_focus_on_row();

			return false;
		});

		this.custom_buttons = {};
		this.grid_buttons = this.wrapper.find('.grid-buttons');
		this.remove_rows_button = this.grid_buttons.find('.grid-remove-rows')

		this.setup_allow_bulk_edit();
		this.setup_check();
		if(this.df.on_setup) {
			this.df.on_setup(this);
		}
	}

	setup_check() {
		var me = this;

		this.wrapper.on('click', '.grid-row-check', function(e) {
			var $check = $(this);
			if($check.parents('.grid-heading-row:first').length!==0) {
				// select all?
				var checked = $check.prop('checked');
				$check.parents('.form-grid:first')
					.find('.grid-row-check').prop('checked', checked);

				// set all
				(me.grid_rows || []).forEach(function(row) { row.doc.__checked = checked ? 1 : 0; });
			} else {
				var docname = $check.parents('.grid-row:first').attr('data-name');
				me.grid_rows_by_docname[docname].select($check.prop('checked'));
			}
			me.refresh_remove_rows_button();
		});

		this.remove_rows_button.on('click', function() {
			var dirty = false;

			let tasks = [];
			me.get_selected_children().forEach((doc) => {
				tasks.push(() => {
					if (!me.frm) {
						me.df.data = me.get_data();
						me.df.data = me.df.data.filter((row)=> row.idx != doc.idx);
					}
					dirty = true;
					return me.grid_rows_by_docname[doc.name].remove();
				});
				// tasks.push(() => frappe.timeout(0.01));
			});

			if (!me.frm) {
				tasks.push(() => {
					// reorder idx of df.data
					me.df.data.forEach((row, index) => row.idx = index + 1);
				});
			}

			tasks.push(() => {
				if (dirty) me.refresh();
			});

			frappe.run_serially(tasks);
		});
	}
	select_row(name) {
		this.grid_rows_by_docname[name].select();
	}
	remove_all() {
		this.grid_rows.forEach(row => {
			row.remove();
		});
	}
	refresh_remove_rows_button() {
		this.remove_rows_button.toggleClass('hidden',
			this.wrapper.find('.grid-body .grid-row-check:checked:first').length ? false : true);
	}
	get_selected() {
		return (this.grid_rows || []).map(function(row) { return row.doc.__checked ? row.doc.name : null; })
			.filter(function(d) { return d; });
	}
	get_selected_children() {
		return (this.grid_rows || []).map(function(row) { return row.doc.__checked ? row.doc : null; })
			.filter(function(d) { return d; });
	}
	make_head() {
		// labels
		if(!this.header_row) {
			this.header_row = new GridRow({
				parent: $(this.parent).find(".grid-heading-row"),
				parent_df: this.df,
				docfields: this.docfields,
				frm: this.frm,
				grid: this
			});
		}
	}
	refresh(force) {
		!this.wrapper && this.make();
		var me = this,
			$rows = $(me.parent).find(".rows"),
			data = this.get_data();

		this.setup_fields();

		if(this.frm) {
			this.display_status = frappe.perm.get_field_display_status(this.df, this.frm.doc,
				this.perm);
		} else {
			// not in form
			this.display_status = 'Write';
		}

		if(this.display_status === "None") return;

		// redraw
		var _scroll_y = $(document).scrollTop();
		this.make_head();

		if(!this.grid_rows) {
			this.grid_rows = [];
		}

		this.truncate_rows(data);
		this.grid_rows_by_docname = {};

		for(var ri=0; ri < data.length; ri++) {
			var d = data[ri];

			if(d.idx===undefined) {
				d.idx = ri + 1;
			}

			if(this.grid_rows[ri]) {
				var grid_row = this.grid_rows[ri];
				grid_row.doc = d;
				grid_row.refresh();
			} else {
				var grid_row = new GridRow({
					parent: $rows,
					parent_df: this.df,
					docfields: this.docfields,
					doc: d,
					frm: this.frm,
					grid: this
				});
				this.grid_rows.push(grid_row);
			}

			this.grid_rows_by_docname[d.name] = grid_row;
		}

		this.wrapper.find(".grid-empty").toggleClass("hidden", Boolean(data.length));

		// toolbar
		this.setup_toolbar();
		// this.toggle_checkboxes(this.display_status !== 'Read');

		// sortable
		if(this.frm && this.is_sortable() && !this.sortable_setup_done) {
			this.make_sortable($rows);
			this.sortable_setup_done = true;
		}

		this.last_display_status = this.display_status;
		this.last_docname = this.frm && this.frm.docname;

		// frappe.utils.scroll_to(_scroll_y);

		// red if mandatory
		this.form_grid.toggleClass('error', !!(this.df.reqd && !(data && data.length)));

		this.refresh_remove_rows_button();

		this.wrapper.trigger('change');
	}
	setup_toolbar() {
		if(this.is_editable()) {
			this.wrapper.find(".grid-footer").toggle(true);

			// show, hide buttons to add rows
			if(this.cannot_add_rows || (this.df && this.df.cannot_add_rows)) {
				// add 'hidden' to buttons
				this.wrapper.find(".grid-add-row, .grid-add-multiple-rows")
					.addClass('hidden');
			} else {
				// show buttons
				this.wrapper.find(".grid-add-row").removeClass('hidden');

				if(this.multiple_set) {
					this.wrapper.find(".grid-add-multiple-rows").removeClass('hidden');
				}
			}

		} else {
			this.wrapper.find(".grid-footer").toggle(false);
		}

	}
	truncate_rows(data) {
		if(this.grid_rows.length > data.length) {
			// remove extra rows
			for(var i=data.length; i < this.grid_rows.length; i++) {
				var grid_row = this.grid_rows[i];
				grid_row.wrapper.remove();
			}
			this.grid_rows.splice(data.length);
		}
	}
	setup_fields() {
		var me = this;
		// reset docfield
		if (this.frm && this.frm.docname) {
			// use doc specific docfield object
			this.df = frappe.meta.get_docfield(this.frm.doctype, this.df.fieldname,
				this.frm.docname);
		} else {
			// use non-doc specific docfield
			if(this.df.options) {
				this.df = frappe.meta.get_docfield(this.df.options, this.df.fieldname) || this.df || null;
			}
		}

		if(this.doctype && this.frm) {
			this.docfields = frappe.meta.get_docfields(this.doctype, this.frm.docname);
		} else {
			// fields given in docfield
			this.docfields = this.df.fields;
		}

		this.docfields.forEach(function(df) {
			me.fields_map[df.fieldname] = df;
		});
	}
	refresh_row(docname) {
		this.grid_rows_by_docname[docname] &&
			this.grid_rows_by_docname[docname].refresh();
	}
	make_sortable($rows) {
		new Sortable($rows.get(0), {
			group: {name: this.df.fieldname},
			handle: '.sortable-handle',
			draggable: '.grid-row',
			animation: 100,
			filter: 'li, a',
			onMove: (event) => {
				// don't move if editable
				if (!this.is_editable()) {
					return false;
				}
				// prevent drag behaviour if _sortable property is "false"
				let idx = $(event.dragged).closest('.grid-row').attr('data-idx');
				let doc = this.get_data()[idx - 1];
				if (doc && doc._sortable === false) {
					return false;
				}
			},
			onUpdate: (event) => {
				let idx = $(event.item).closest('.grid-row').attr('data-idx');
				let doc = this.get_data()[idx - 1];
				this.renumber_based_on_dom();
				this.frm.script_manager.trigger(this.df.fieldname + "_move", this.df.options, doc.name);
				this.refresh();
				this.frm.dirty();
			}
		});

		$(this.frm.wrapper).trigger("grid-make-sortable", [this.frm]);
	}
	get_data() {
		var data = this.frm ?
			this.frm.doc[this.df.fieldname] || []
			: this.df.data || this.get_modal_data();
		data.sort(function(a, b) { return a.idx - b.idx});
		return data;
	}
	get_modal_data() {
		return this.df.get_data() ? this.df.get_data().filter(data => {
			if (!this.deleted_docs || !in_list(this.deleted_docs, data.name)) {
				return data;
			}
		}) : [];
	}
	set_column_disp(fieldname, show, do_not_refresh) {
		if($.isArray(fieldname)) {
			var me = this;
			for(var i=0, l=fieldname.length; i<l; i++) {
				var fname = fieldname[i];
				me.get_docfield(fname).hidden = show ? 0 : 1;
				this.set_editable_grid_column_disp(fname, show, do_not_refresh);
			}
		} else {
			this.get_docfield(fieldname).hidden = show ? 0 : 1;
			this.set_editable_grid_column_disp(fieldname, show, do_not_refresh);
		}

		if (!do_not_refresh) {
			this.refresh(true);
		}
	}
	set_editable_grid_column_disp(fieldname, show, do_not_refresh) {
		//Hide columns for editable grids
		if (this.meta.editable_grid && this.grid_rows) {
			this.grid_rows.forEach(function(row) {
				row.columns_list.forEach(function(column) {
					//Hide the column specified
					if (column.df.fieldname == fieldname) {
						if (show) {
							column.df.hidden = false;

							//Show the static area and hide field area if it is not the editable row
							if  (row != frappe.ui.form.editable_row) {
								column.static_area.show();
								column.field_area && column.field_area.toggle(false);
							}
							//Hide the static area and show field area if it is the editable row
							else {
								column.static_area.hide();
								column.field_area && column.field_area.toggle(true);

								//Format the editable column appropriately if it is now visible
								if (column.field) {
									column.field.refresh();
									if (column.field.$input) column.field.$input.toggleClass('input-sm', true);
								}
							}
						}
						else {
							column.df.hidden = true;
							column.static_area.hide();
						}
					}
				});
			});
		}

		if (!do_not_refresh) {
			this.refresh();
		}
	}
	toggle_reqd(fieldname, reqd) {
		this.get_docfield(fieldname).reqd = reqd;
		this.refresh();
	}
	toggle_enable(fieldname, enable) {
		this.get_docfield(fieldname).read_only = enable ? 0 : 1;
		this.refresh();
	}
	toggle_display(fieldname, show) {
		this.get_docfield(fieldname).hidden = show ? 0 : 1;
		this.refresh();
	}
	toggle_checkboxes(enable) {
		this.wrapper.find(".grid-row-check").prop('disabled', !enable)
	}
	get_docfield(fieldname) {
		return frappe.meta.get_docfield(this.doctype, fieldname, this.frm ? this.frm.docname : null);
	}
	get_row(key) {
		if(typeof key == 'number') {
			if(key < 0) {
				return this.grid_rows[this.grid_rows.length + key];
			} else {
				return this.grid_rows[key];
			}
		} else {
			return this.grid_rows_by_docname[key];
		}
	}
	get_grid_row(key) {
		return this.get_row(key);
	}
	get_field(fieldname) {
		// Note: workaround for get_query
		if(!this.fieldinfo[fieldname])
			this.fieldinfo[fieldname] = {
			}
		return this.fieldinfo[fieldname];
	}
	set_value(fieldname, value, doc) {
		if(this.display_status!=="None" && this.grid_rows_by_docname[doc.name]) {
			this.grid_rows_by_docname[doc.name].refresh_field(fieldname, value);
		}
	}
	add_new_row(idx, callback, show, copy_doc) {
		if(this.is_editable()) {
			if(this.frm) {
				var d = frappe.model.add_child(this.frm.doc, this.df.options, this.df.fieldname, idx);
				if(copy_doc) {
					d = this.duplicate_row(d, copy_doc);
				}
				d.__unedited = true;
				this.frm.script_manager.trigger(this.df.fieldname + "_add", d.doctype, d.name);
				this.refresh();
			} else {
				if (!this.df.data) {
					this.df.data = this.get_data() || [];
				}
				this.df.data.push({idx: this.df.data.length+1, __islocal: true});
				this.refresh();
			}

			if(show) {
				if(idx) {
					// always open inserted rows
					this.wrapper.find("[data-idx='"+idx+"']").data("grid_row")
						.toggle_view(true, callback);
				} else {
					if(!this.allow_on_grid_editing()) {
						// open last row only if on-grid-editing is disabled
						this.wrapper.find(".grid-row:last").data("grid_row")
							.toggle_view(true, callback);
					}
				}
			}

			return d;
		}
	}

	renumber_based_on_dom() {
		// renumber based on dom
		let me = this;
		let $rows = $(me.parent).find(".rows");

		me.grid_rows = [];
		me.frm.doc[me.df.fieldname] = [];

		$rows.find(".grid-row").each(function(i, item) {

			let $item = $(item);
			let d = locals[me.doctype][$item.attr('data-name')];
			d.idx = i + 1;
			$item.attr('data-idx', d.idx);

			me.frm.doc[me.df.fieldname].push(d);
			me.grid_rows.push(me.grid_rows_by_docname[d.name]);
		});
	}

	duplicate_row(d, copy_doc) {
		for (let [key, value] of Object.entries(copy_doc)) {
			if(!["creation", "modified", "modified_by", "idx", "owner",
				"parent", "doctype", "name", "parentield"].includes(key)) {
				d[key] = value;
			}
		}

		return d;
	}

	set_focus_on_row(idx) {
		var me = this;
		if(idx == null) {
			idx = me.grid_rows.length - 1;
		}
		me.grid_rows[idx].row
			.find('input[type="Text"],textarea,select').filter(':visible:first').focus();
	}

	setup_visible_columns() {
		if (this.visible_columns) return;

		var total_colsize = 1,
			fields = this.editable_fields || this.docfields;

		this.visible_columns = [];

		for(var ci in fields) {
			var _df = fields[ci];

			// get docfield if from fieldname
			df = this.fields_map[_df.fieldname];

			if(!df.hidden
				&& (this.editable_fields || df.in_list_view)
				&& (this.frm && this.frm.get_perm(df.permlevel, "read") || !this.frm)
				&& !in_list(frappe.model.layout_fields, df.fieldtype)) {

				if(df.columns) {
					df.colsize=df.columns;
				}
				else {
					var colsize = 2;
					switch (df.fieldtype) {
						case "Text": break;
						case "Small Text": colsize = 3; break;
						case "Check": colsize = 1;
					}
					df.colsize = colsize;
				}

				// attach formatter on refresh
				if (df.fieldtype == 'Link' && !df.formatter && df.parent && frappe.meta.docfield_map[df.parent]) {
					const docfield = frappe.meta.docfield_map[df.parent][df.fieldname];
					if (docfield && docfield.formatter) {
						df.formatter = docfield.formatter;
					}
				}

				total_colsize += df.colsize;
				if(total_colsize > 11)
					return false;
				this.visible_columns.push([df, df.colsize]);
			}
		}

		// redistribute if total-col size is less than 12
		var passes = 0;
		while(total_colsize < 11 && passes < 12) {
			for(var i in this.visible_columns) {
				var df = this.visible_columns[i][0];
				var colsize = this.visible_columns[i][1];
				if(colsize > 1 && colsize < 11
					&& !in_list(frappe.model.std_fields_list, df.fieldname)) {

					if (passes < 3 && ["Int", "Currency", "Float", "Check", "Percent"].indexOf(df.fieldtype)!==-1) {
						// don't increase col size of these fields in first 3 passes
						continue;
					}

					this.visible_columns[i][1] += 1;
					total_colsize++;
				}

				if(total_colsize > 10)
					break;
			}
			passes++;
		}
	}


	is_editable() {
		return this.display_status=="Write" && !this.static_rows;
	}
	is_sortable() {
		return this.sortable_status || this.is_editable();
	}
	only_sortable(status) {
		if(status===undefined ? true : status) {
			this.sortable_status = true;
			this.static_rows = true;
		}
	}
	set_multiple_add(link, qty) {
		if(this.multiple_set) return;
		var me = this;
		var link_field = frappe.meta.get_docfield(this.df.options, link);
		var btn = $(this.wrapper).find(".grid-add-multiple-rows");

		// show button
		btn.removeClass('hidden');

		// open link selector on click
		btn.on("click", function() {
			new frappe.ui.form.LinkSelector({
				doctype: link_field.options,
				fieldname: link,
				qty_fieldname: qty,
				target: me,
				txt: ""
			});
			return false;
		});
		this.multiple_set = true;
	}
	setup_allow_bulk_edit() {
		var me = this;
		if(this.frm && this.frm.get_docfield(this.df.fieldname).allow_bulk_edit) {
			// download
			me.setup_download();

			// upload
			frappe.flags.no_socketio = true;
			$(this.wrapper).find(".grid-upload").removeClass('hidden').on("click", function() {
				new frappe.ui.FileUploader({
					as_dataurl: true,
					allow_multiple: false,
					on_success(file) {
						if (file.file_obj.type !== "text/csv") {
							let msg = __(`Your file could not be processed. It should be a standard CSV file.`);
							frappe.throw(msg);
						}
						var data = frappe.utils.csv_to_array(frappe.utils.get_decoded_string(file.dataurl));
						// row #2 contains fieldnames;
						var fieldnames = data[4];

						me.frm.clear_table(me.df.fieldname);
						$.each(data, function(i, row) {
							if(i > 6) {
								var blank_row = true;
								$.each(row, function(ci, value) {
									if(value) {
										blank_row = false;
										return false;
									}
								});

								if(!blank_row) {
									var d = me.frm.add_child(me.df.fieldname);
									$.each(row, function(ci, value) {
										var fieldname = fieldnames[ci];
										var df = frappe.meta.get_docfield(me.df.options, fieldname);

										// convert date formatting
										if(df.fieldtype==="Date" && value) {
											value = frappe.datetime.user_to_str(value);
										}

										if(df.fieldtype==="Int" || df.fieldtype==="Check") {
											value = cint(value);
										}

										if(df.fieldtype==="Float" || df.fieldtype==="Currency") {
											value = flt(value);
										}

										d[fieldnames[ci]] = value;
									});
								}
							}
						});
						me.frm.trigger(me.df.fieldname + '_after_bulk_upload');
						me.frm.refresh_field(me.df.fieldname);
						frappe.msgprint({message:__('Table updated'), title:__('Success'), indicator:'green'})
					}
				});
				return false;
			});
		}
	}
	setup_download() {
		var me = this;
		let title = me.df.label || frappe.model.unscrub(me.df.fieldname);
		$(this.wrapper).find(".grid-download").removeClass('hidden').on("click", function() {
			var data = [];
			var docfields = [];
			data.push([__("Bulk Edit {0}", [title])]);
			data.push([__("The CSV format is case sensitive")]);
			data.push([__("Do not edit headers which are preset in the template")]);
			data.push([]);
			data.push([]);
			data.push([]);
			data.push(["----- Insert After This Line -----"]);
			$.each(frappe.get_meta(me.df.options).fields, function(i, df) {
				// don't include the read-only field in the template
				if(frappe.model.is_value_type(df.fieldtype) && !df.read_only) {
					data[3].push(df.label);
					data[4].push(df.fieldname);
					let description = (df.description || "") + ' ';
					if (df.fieldtype === "Date") {
						description += frappe.boot.sysdefaults.date_format;
					}
					data[5].push(description);
					docfields.push(df);
				}
			});

			// add data
			$.each(me.frm.doc[me.df.fieldname] || [], function(i, d) {
				var row = [];
				$.each(data[4], function(i, fieldname) {
					var value = d[fieldname];

					// format date
					if(docfields[i].fieldtype==="Date" && value) {
						value = frappe.datetime.str_to_user(value);
					}

					row.push(value || "");
				});
				data.push(row);
			});

			frappe.tools.downloadify(data, null, title);
			return false;
		});
	}
	add_custom_button(label, click) {
		// add / unhide a custom button
		var btn = this.custom_buttons[label];
		if(!btn) {
			btn = $('<button class="btn btn-default btn-xs btn-custom">' + label + '</button>')
				.css('margin-left', '2px')
				.appendTo(this.grid_buttons)
				.on('click', click);
			this.custom_buttons[label] = btn;
		} else {
			btn.removeClass('hidden');
		}
	}
	clear_custom_buttons() {
		// hide all custom buttons
		this.grid_buttons.find('.btn-custom').addClass('hidden');
	}
}
