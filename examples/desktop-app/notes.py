#!/usr/bin/env python3
"""A tiny GTK 3 notes app used to test Screenplay's desktop recording on Linux."""
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

CSS = b"""
window { background: #f7f7f8; }
.title { font-size: 20px; font-weight: 700; }
.note { background: white; border-radius: 10px; padding: 12px; border: 1px solid #e4e4e7; }
.saved { color: #16a34a; font-weight: 600; }
button.suggested-action { background: #4f46e5; color: white; border-radius: 8px; padding: 6px 14px; }
"""

class Notes(Gtk.Window):
    def __init__(self):
        super().__init__(title="Notes")
        self.set_default_size(900, 600)
        prov = Gtk.CssProvider(); prov.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(self.get_screen(), prov, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, margin=24)
        self.add(root)
        head = Gtk.Box(spacing=10)
        t = Gtk.Label(label="My notes", xalign=0); t.get_style_context().add_class("title")
        head.pack_start(t, True, True, 0)
        self.new_btn = Gtk.Button(label="New note"); self.new_btn.connect("clicked", self.on_new)
        head.pack_end(self.new_btn, False, False, 0)
        root.pack_start(head, False, False, 0)
        self.list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        for text in ["Call the bakery about Saturday", "Renew the domain before Friday"]:
            self.add_note(text)
        root.pack_start(self.list, False, False, 0)
        self.editor = Gtk.Box(spacing=10)
        self.entry = Gtk.Entry(placeholder_text="Write a note…")
        self.entry.get_accessible().set_name("Note text")
        self.save_btn = Gtk.Button(label="Save"); self.save_btn.get_style_context().add_class("suggested-action")
        self.save_btn.connect("clicked", self.on_save)
        self.editor.pack_start(self.entry, True, True, 0)
        self.editor.pack_end(self.save_btn, False, False, 0)
        root.pack_start(self.editor, False, False, 0)
        self.status = Gtk.Label(label="", xalign=0); self.status.get_style_context().add_class("saved")
        root.pack_start(self.status, False, False, 0)
        self.connect("destroy", Gtk.main_quit)

    def add_note(self, text):
        l = Gtk.Label(label=text, xalign=0); l.get_style_context().add_class("note")
        self.list.pack_start(l, False, False, 0); l.show()

    def on_new(self, *_):
        self.entry.grab_focus()

    def on_save(self, *_):
        text = self.entry.get_text().strip()
        if text:
            self.add_note(text); self.entry.set_text(""); self.status.set_text("Note saved")

w = Notes(); w.show_all(); Gtk.main()
