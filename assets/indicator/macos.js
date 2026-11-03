// The pill that tells the person at the Mac that Screenplay is driving it (and filming).
// Run with `osascript -l JavaScript macos.js <label> <parent pid> [selftest]`.
// It is left out of screen captures (NSWindowSharingNone), stays on top on every Space,
// never takes focus, and survives "Hide others". Stop exits with code 3; the pill also
// quits by itself when the Screenplay process that started it is gone.
ObjC.import("Cocoa");
ObjC.import("stdlib");
ObjC.import("signal");

function run(argv) {
  const text = argv[0] || "Screenplay is recording";
  const parent = Number(argv[1] || 0);
  const selftest = argv[2] === "selftest";

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  app.finishLaunching;

  ObjC.registerSubclass({
    name: "SPStopTarget",
    methods: { "stop:": { types: ["void", ["id"]], implementation: () => $.exit(3) } },
  });
  const target = $.SPStopTarget.alloc.init;

  const rgba = (r, g, b, a) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, g / 255, b / 255, a);
  const H = 36;

  const label = $.NSTextField.labelWithString(text);
  label.font = $.NSFont.systemFontOfSizeWeight(13, 0.23);
  label.textColor = rgba(255, 255, 255, 0.95);
  label.sizeToFit;
  const lw = Math.ceil(label.frame.size.width);

  const stop = $.NSButton.buttonWithTitleTargetAction("Stop", target, "stop:");
  stop.bezelStyle = $.NSBezelStyleRounded;
  stop.controlSize = $.NSControlSizeSmall;
  stop.font = $.NSFont.systemFontOfSizeWeight(11, 0.3);
  stop.sizeToFit;
  const bw = Math.ceil(stop.frame.size.width);
  const bh = Math.ceil(stop.frame.size.height);

  const W = 14 + 8 + 9 + lw + 10 + bw + 8;
  const vf = $.NSScreen.mainScreen.visibleFrame;
  const rect = $.NSMakeRect(vf.origin.x + Math.round((vf.size.width - W) / 2), vf.origin.y + vf.size.height - H - 10, W, H);

  const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(rect, $.NSWindowStyleMaskBorderless | $.NSWindowStyleMaskNonactivatingPanel, $.NSBackingStoreBuffered, false);
  panel.appearance = $.NSAppearance.appearanceNamed($.NSAppearanceNameDarkAqua);
  panel.opaque = false;
  panel.backgroundColor = $.NSColor.clearColor;
  panel.hasShadow = true;
  panel.level = $.NSStatusWindowLevel;
  panel.sharingType = $.NSWindowSharingNone;
  panel.canHide = false;
  panel.hidesOnDeactivate = false;
  panel.movableByWindowBackground = true;
  panel.collectionBehavior =
    $.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorStationary | $.NSWindowCollectionBehaviorIgnoresCycle | $.NSWindowCollectionBehaviorFullScreenAuxiliary;

  // NSBox draws rounded fills without Core Animation colors, which JXA cannot pass.
  const box = (frame, fill, radius, border) => {
    const b = $.NSBox.alloc.initWithFrame(frame);
    b.boxType = $.NSBoxCustom;
    b.titlePosition = $.NSNoTitle;
    b.contentViewMargins = $.NSMakeSize(0, 0);
    b.fillColor = fill;
    b.cornerRadius = radius;
    b.borderWidth = border ? 1 : 0;
    b.borderColor = border || $.NSColor.clearColor;
    return b;
  };
  const pill = box($.NSMakeRect(0, 0, W, H), rgba(24, 24, 27, 0.92), H / 2, rgba(255, 255, 255, 0.14));
  const dot = box($.NSMakeRect(14, (H - 8) / 2, 8, 8), rgba(255, 69, 58, 1), 4);

  label.setFrameOrigin($.NSMakePoint(14 + 8 + 9, Math.round((H - label.frame.size.height) / 2)));
  stop.setFrameOrigin($.NSMakePoint(W - bw - 8, Math.round((H - bh) / 2)));

  const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));
  view.addSubview(pill);
  view.addSubview(dot);
  view.addSubview(label);
  view.addSubview(stop);
  panel.contentView = view;
  panel.orderFrontRegardless;

  if (selftest) stop.performClick(null);

  // The dot blinks softly; the loop also handles clicks and watches the parent process.
  let lit = true;
  let next = Date.now();
  for (;;) {
    const ev = app.nextEventMatchingMaskUntilDateInModeDequeue($.NSEventMaskAny, $.NSDate.dateWithTimeIntervalSinceNow(0.25), $.NSDefaultRunLoopMode, true);
    if (ev && !ev.isNil()) app.sendEvent(ev);
    if (Date.now() >= next) {
      lit = !lit;
      dot.animator.alphaValue = lit ? 1 : 0.3;
      next = Date.now() + 800;
      if (parent && $.kill(parent, 0) !== 0) $.exit(0);
    }
  }
}
