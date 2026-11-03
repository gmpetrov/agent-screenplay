# The pill that tells the person at the PC that Screenplay is driving it (and filming).
# Run with: powershell -NoProfile -ExecutionPolicy Bypass -File windows.ps1 <label> <parent pid> [selftest]
# It is left out of screen captures (WDA_EXCLUDEFROMCAPTURE), stays on top, never takes focus.
# Stop exits with code 3; the pill also quits when the Screenplay process that started it is gone.
param([string]$Label = "Screenplay is recording", [int]$ParentPid = 0, [string]$Mode = "")

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class ScreenplayPill : Form {
  [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);
  const int WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x8000000;
  readonly int parent;
  bool lit = true;
  readonly Panel dot;
  public readonly Button StopButton;

  public ScreenplayPill(string text, int parentPid) {
    parent = parentPid;
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(24, 24, 27);
    Font = new Font("Segoe UI Semibold", 9.75f);
    int h = 36;

    dot = new Panel { BackColor = Color.FromArgb(255, 69, 58), Size = new Size(8, 8), Location = new Point(14, (h - 8) / 2) };
    var dp = new GraphicsPath(); dp.AddEllipse(0, 0, 8, 8); dot.Region = new Region(dp);

    var label = new Label { Text = text, ForeColor = Color.White, AutoSize = true, BackColor = Color.Transparent };
    label.Location = new Point(31, (h - label.PreferredHeight) / 2);

    StopButton = new Button { Text = "Stop", FlatStyle = FlatStyle.Flat, ForeColor = Color.White, BackColor = Color.FromArgb(60, 60, 66), Size = new Size(52, 24), TabStop = false };
    StopButton.FlatAppearance.BorderSize = 0;
    StopButton.Click += (s, e) => Environment.Exit(3);

    int w = 31 + label.PreferredWidth + 10 + 52 + 8;
    Size = new Size(w, h);
    StopButton.Location = new Point(w - 52 - 8, (h - 24) / 2);
    var area = Screen.PrimaryScreen.WorkingArea;
    Location = new Point(area.X + (area.Width - w) / 2, area.Y + 10);
    var path = new GraphicsPath();
    path.AddArc(0, 0, h, h, 90, 180); path.AddArc(w - h, 0, h, h, 270, 180); path.CloseFigure();
    Region = new Region(path);
    Controls.Add(dot); Controls.Add(label); Controls.Add(StopButton);

    var timer = new Timer { Interval = 800 };
    timer.Tick += (s, e) => {
      lit = !lit;
      dot.BackColor = lit ? Color.FromArgb(255, 69, 58) : Color.FromArgb(110, 40, 38);
      if (parent > 0) { try { Process.GetProcessById(parent); } catch (ArgumentException) { Environment.Exit(0); } }
    };
    timer.Start();
  }

  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE; return cp; }
  }
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    SetWindowDisplayAffinity(Handle, 0x11); // WDA_EXCLUDEFROMCAPTURE (Windows 10 2004+)
  }
}
"@

$pill = New-Object ScreenplayPill($Label, $ParentPid)
if ($Mode -eq "selftest") { $pill.add_Shown({ $pill.StopButton.PerformClick() }) }
[System.Windows.Forms.Application]::Run($pill)
