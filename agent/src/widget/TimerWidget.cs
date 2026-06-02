using System;
using System.Drawing;
using System.Windows.Forms;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Media;
using System.Speech.Synthesis;

namespace KidsControl
{
    public class TimerWidget : Form
    {
        private Label lblTime;
        private Label lblPhase;
        private Label lblLockMessage;
        private TextBox txtPin;
        private TcpListener listener;
        private Thread serverThread;
        private Thread sirenThread;
        private bool isRunning = true;
        private bool isLocked = false;
        private string lockPin = "";
        
        private bool playSound = true;
        private bool readMessage = false;
        private bool readMessageRepeat = false;
        private string currentLockMessage = "";
        private ReminderPopup activeReminderPopup = null;

        // Hook variables
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        private static LowLevelKeyboardProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static bool hookActive = false;

        public TimerWidget()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.BackColor = Color.Black;
            this.TransparencyKey = Color.Black; 
            this.StartPosition = FormStartPosition.Manual;
            this.Size = new Size(200, 70);
            PositionMiniWidgetOnPrimaryTop();

            lblPhase = new Label();
            lblPhase.ForeColor = Color.White;
            lblPhase.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            lblPhase.AutoSize = false;
            lblPhase.Size = new Size(200, 20);
            lblPhase.Location = new Point(0, 0);
            lblPhase.TextAlign = ContentAlignment.BottomCenter;
            this.Controls.Add(lblPhase);

            lblTime = new Label();
            lblTime.ForeColor = Color.White;
            lblTime.Font = new Font("Segoe UI", 24, FontStyle.Bold);
            lblTime.AutoSize = false;
            lblTime.Size = new Size(200, 50);
            lblTime.Location = new Point(0, 20);
            lblTime.TextAlign = ContentAlignment.TopCenter;
            this.Controls.Add(lblTime);

            lblLockMessage = new Label();
            lblLockMessage.ForeColor = Color.White;
            lblLockMessage.Font = new Font("Segoe UI", 36, FontStyle.Bold);
            lblLockMessage.AutoSize = false;
            lblLockMessage.Size = new Size(Screen.PrimaryScreen.Bounds.Width, 200);
            lblLockMessage.Location = new Point(0, (Screen.PrimaryScreen.Bounds.Height - 200) / 2 - 50);
            lblLockMessage.TextAlign = ContentAlignment.MiddleCenter;
            lblLockMessage.Visible = false;
            this.Controls.Add(lblLockMessage);

            txtPin = new TextBox();
            txtPin.Font = new Font("Segoe UI", 24, FontStyle.Bold);
            txtPin.PasswordChar = '*';
            txtPin.Size = new Size(300, 50);
            txtPin.Location = new Point((Screen.PrimaryScreen.Bounds.Width - txtPin.Width) / 2, (Screen.PrimaryScreen.Bounds.Height - 200) / 2 + 150);
            txtPin.TextAlign = HorizontalAlignment.Center;
            txtPin.Visible = false;
            txtPin.TextChanged += TxtPin_TextChanged;
            this.Controls.Add(txtPin);

            this.Opacity = 0;

            serverThread = new Thread(StartServer);
            serverThread.IsBackground = true;
            serverThread.Start();
        }

        private void PositionMiniWidgetOnPrimaryTop()
        {
            Rectangle primary = Screen.PrimaryScreen.Bounds;
            this.Size = new Size(200, 70);
            this.Location = new Point(primary.Left + (primary.Width - this.Width) / 2, primary.Top + 10);
        }

        private void ApplyLockLayoutForAllMonitors()
        {
            Rectangle virtualScreen = SystemInformation.VirtualScreen;
            Rectangle primary = Screen.PrimaryScreen.Bounds;

            this.Bounds = virtualScreen;
            this.TopMost = true;
            this.Opacity = 1;

            // Keep lock message and PIN centered on the primary monitor,
            // while the overlay itself covers the entire virtual desktop.
            int primaryX = primary.Left - virtualScreen.Left;
            int primaryY = primary.Top - virtualScreen.Top;

            lblLockMessage.Size = new Size(primary.Width, 200);
            lblLockMessage.Location = new Point(primaryX, primaryY + (primary.Height - 200) / 2 - 50);

            txtPin.Location = new Point(primaryX + (primary.Width - txtPin.Width) / 2, primaryY + (primary.Height - 200) / 2 + 150);
        }

        private void ShowReminderPopup(string reminderId, string message, bool voiceLoop)
        {
            if (activeReminderPopup != null)
            {
                try { activeReminderPopup.SafeClose(); } catch { }
                activeReminderPopup = null;
            }

            activeReminderPopup = new ReminderPopup(reminderId, message, voiceLoop, (id) => {
                NotifyReminderDismissed(id);
            });
            activeReminderPopup.FormClosed += (s, e) => {
                if (ReferenceEquals(activeReminderPopup, s))
                {
                    activeReminderPopup = null;
                }
            };
            activeReminderPopup.Show();
            activeReminderPopup.BringToFront();
            activeReminderPopup.Activate();
        }

        private static void PositionBottomRight(Form form)
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int margin = 18;
            form.Location = new Point(
                area.Right - form.Width - margin,
                area.Bottom - form.Height - margin
            );
        }

        private void NotifyReminderDismissed(string reminderId)
        {
            new Thread(() => {
                try
                {
                    using (TcpClient c = new TcpClient("127.0.0.1", 49153))
                    using (NetworkStream s = c.GetStream())
                    {
                        byte[] data = Encoding.UTF8.GetBytes("reminder_dismissed|" + reminderId);
                        s.Write(data, 0, data.Length);
                    }
                }
                catch { }
            }).Start();
        }

        private sealed class ReminderPopup : Form
        {
            private readonly string reminderId;
            private readonly Action<string> onDismiss;
            private readonly bool voiceLoop;
            private readonly string text;
            private readonly Label lblMessage;
            private readonly Button btnDismiss;
            private readonly Button btnStopVoice;
            private Thread voiceThread;
            private SpeechSynthesizer synth;
            private volatile bool isRunning = true;

            public ReminderPopup(string reminderId, string message, bool voiceLoop, Action<string> onDismiss)
            {
                this.reminderId = reminderId ?? "";
                this.onDismiss = onDismiss;
                this.voiceLoop = voiceLoop;
                this.text = string.IsNullOrWhiteSpace(message) ? "Напоминание" : message;

                this.Text = "Напоминание";
                this.FormBorderStyle = FormBorderStyle.None;
                this.MaximizeBox = false;
                this.MinimizeBox = false;
                this.StartPosition = FormStartPosition.Manual;
                this.Size = new Size(430, 230);
                this.TopMost = true;
                this.ShowInTaskbar = false;
                this.BackColor = Color.FromArgb(24, 28, 38);
                this.ForeColor = Color.White;

                var title = new Label();
                title.Text = "Напоминание";
                title.Font = new Font("Segoe UI", 12, FontStyle.Bold);
                title.ForeColor = Color.White;
                title.Location = new Point(18, 14);
                title.Size = new Size(320, 26);
                this.Controls.Add(title);

                var closeButton = new Button();
                closeButton.Text = "x";
                closeButton.Font = new Font("Segoe UI", 10, FontStyle.Bold);
                closeButton.Size = new Size(30, 28);
                closeButton.Location = new Point(this.Width - 44, 12);
                closeButton.FlatStyle = FlatStyle.Flat;
                closeButton.FlatAppearance.BorderSize = 0;
                closeButton.BackColor = Color.Transparent;
                closeButton.ForeColor = Color.FromArgb(150, 160, 180);
                closeButton.Cursor = Cursors.Hand;
                closeButton.Click += (s, e) => Dismiss();
                this.Controls.Add(closeButton);

                lblMessage = new Label();
                lblMessage.Text = this.text;
                lblMessage.Font = new Font("Segoe UI", 13, FontStyle.Regular);
                lblMessage.ForeColor = Color.FromArgb(226, 232, 240);
                lblMessage.TextAlign = ContentAlignment.MiddleLeft;
                lblMessage.Location = new Point(18, 52);
                lblMessage.Size = new Size(394, 92);
                this.Controls.Add(lblMessage);

                btnStopVoice = new Button();
                btnStopVoice.Text = "Остановить звук";
                btnStopVoice.Font = new Font("Segoe UI", 10, FontStyle.Bold);
                btnStopVoice.Size = new Size(164, 40);
                btnStopVoice.Location = new Point(18, 166);
                btnStopVoice.BackColor = Color.FromArgb(45, 52, 70);
                btnStopVoice.ForeColor = Color.White;
                btnStopVoice.FlatStyle = FlatStyle.Flat;
                btnStopVoice.FlatAppearance.BorderColor = Color.FromArgb(70, 78, 100);
                btnStopVoice.Cursor = Cursors.Hand;
                btnStopVoice.Enabled = voiceLoop;
                btnStopVoice.Click += (s, e) => StopVoice();
                this.Controls.Add(btnStopVoice);

                btnDismiss = new Button();
                btnDismiss.Text = "Понятно";
                btnDismiss.Font = new Font("Segoe UI", 12, FontStyle.Bold);
                btnDismiss.Size = new Size(136, 40);
                btnDismiss.Location = new Point(this.Width - btnDismiss.Width - 18, 166);
                btnDismiss.BackColor = Color.FromArgb(99, 102, 241);
                btnDismiss.ForeColor = Color.White;
                btnDismiss.FlatStyle = FlatStyle.Flat;
                btnDismiss.FlatAppearance.BorderSize = 0;
                btnDismiss.Cursor = Cursors.Hand;
                btnDismiss.Click += (s, e) => Dismiss();
                this.Controls.Add(btnDismiss);

                this.FormClosing += (s, e) => { isRunning = false; };
                this.KeyPreview = true;
                this.KeyDown += (s, e) => {
                    if (e.KeyCode == Keys.Escape || e.KeyCode == Keys.Enter)
                    {
                        e.Handled = true;
                        Dismiss();
                    }
                };

                this.Shown += (s, e) =>
                {
                    PositionBottomRight(this);
                    this.BringToFront();
                    this.Activate();
                    btnDismiss.Focus();
                };

                if (voiceLoop)
                {
                    voiceThread = new Thread(VoiceLoopWorker);
                    voiceThread.IsBackground = true;
                    voiceThread.Start();
                }
            }

            public void SafeClose()
            {
                if (this.IsDisposed) return;
                if (this.InvokeRequired)
                {
                    try { this.BeginInvoke(new MethodInvoker(SafeClose)); } catch { }
                    return;
                }
                isRunning = false;
                StopVoice();
                try { this.Close(); } catch { }
            }

            private void Dismiss()
            {
                isRunning = false;
                StopVoice();
                try
                {
                    if (onDismiss != null) onDismiss(reminderId);
                }
                catch { }
                this.Close();
            }

            private void StopVoice()
            {
                isRunning = false;
                try
                {
                    if (synth != null) synth.SpeakAsyncCancelAll();
                }
                catch { }
                if (btnStopVoice != null)
                {
                    btnStopVoice.Enabled = false;
                    btnStopVoice.Text = "Звук остановлен";
                }
            }

            private void VoiceLoopWorker()
            {
                try
                {
                    using (synth = new SpeechSynthesizer())
                    {
                        synth.SetOutputToDefaultAudioDevice();
                        while (isRunning)
                        {
                            try
                            {
                                synth.SpeakAsync(text);
                                while (isRunning && synth.State == SynthesizerState.Speaking)
                                {
                                    Thread.Sleep(100);
                                }
                            }
                            catch { }
                            if (!isRunning || !voiceLoop) break;
                            Thread.Sleep(1000);
                        }
                    }
                }
                catch { }
            }
        }

        private void StartServer()
        {
            try
            {
                listener = new TcpListener(IPAddress.Loopback, 49152);
                listener.Start();
                while (isRunning)
                {
                    if (listener.Pending())
                    {
                        using (TcpClient client = listener.AcceptTcpClient())
                        using (NetworkStream stream = client.GetStream())
                        {
                            byte[] buffer = new byte[4096];
                            int bytesRead = stream.Read(buffer, 0, buffer.Length);
                            string message = Encoding.UTF8.GetString(buffer, 0, bytesRead).Trim();
                            UpdateUI(message);
                        }
                    }
                    Thread.Sleep(100);
                }
            }
            catch (Exception) { }
        }

        private void UpdateUI(string message)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action<string>(UpdateUI), message);
                return;
            }

            if (message == "hide")
            {
                if (!isLocked) this.Opacity = 0;
            }
            else if (message == "unlock")
            {
                isLocked = false;
                this.TransparencyKey = Color.Black;
                PositionMiniWidgetOnPrimaryTop();
                this.Opacity = 0;
                lblLockMessage.Visible = false;
                txtPin.Visible = false;
                txtPin.Text = "";
                lblPhase.Visible = true;
                lblTime.Visible = true;
                this.BackColor = Color.Black;
                RemoveKeyboardHook();
            }
            else if (message.StartsWith("lock|"))
            {
                isLocked = true;
                string[] parts = message.Split('|');
                string text = parts.Length > 1 ? parts[1] : "Время вышло! Компьютер заблокирован.";
                string hexColor = parts.Length > 2 ? parts[2] : "#000000";
                lockPin = parts.Length > 3 ? parts[3] : "";
                
                playSound = parts.Length > 4 ? (parts[4] == "1") : true;
                readMessage = parts.Length > 5 ? (parts[5] == "1") : false;
                readMessageRepeat = parts.Length > 6 ? (parts[6] == "1") : false;
                currentLockMessage = text;

                this.TransparencyKey = Color.Empty;
                try {
                    this.BackColor = ColorTranslator.FromHtml(hexColor);
                } catch {
                    this.BackColor = Color.Black;
                }

                ApplyLockLayoutForAllMonitors();

                lblPhase.Visible = false;
                lblTime.Visible = false;
                
                lblLockMessage.Text = text;
                lblLockMessage.Visible = true;

                if (!string.IsNullOrEmpty(lockPin)) {
                    txtPin.Visible = true;
                    txtPin.Text = "";
                    txtPin.Focus();
                } else {
                    txtPin.Visible = false;
                }

                SetKeyboardHook();
                
                if (sirenThread == null || !sirenThread.IsAlive) {
                    sirenThread = new Thread(PlaySiren);
                    sirenThread.IsBackground = true;
                    sirenThread.Start();
                }
            }
            else if (message.StartsWith("toast|"))
            {
                // Simple TTS for toast
                string text = message.Substring(6);
                try {
                    SystemSounds.Asterisk.Play();
                    
                } catch {}
            }
            else if (message.StartsWith("reminder|"))
            {
                string[] parts = message.Split('|');
                if (parts.Length >= 4)
                {
                    string reminderId = parts[1];
                    string reminderText = "";
                    try
                    {
                        reminderText = Encoding.UTF8.GetString(Convert.FromBase64String(parts[2]));
                    }
                    catch
                    {
                        reminderText = parts[2];
                    }
                    bool loopVoice = parts[3] == "1";
                    ShowReminderPopup(reminderId, reminderText, loopVoice);
                }
            }
            else if (message.StartsWith("show|"))
            {
                if (isLocked) return;
                string[] parts = message.Split('|');
                if (parts.Length == 3)
                {
                    string phase = parts[1];
                    string time = parts[2];
                    lblPhase.Text = phase;
                    lblTime.Text = time;
                    string lowPhase = phase.ToLower();
                    if (lowPhase.Contains("пауза") || lowPhase.Contains("отдых") || lowPhase.Contains("break"))
                    {
                        lblTime.ForeColor = Color.LimeGreen;
                        lblPhase.ForeColor = Color.LimeGreen;
                    }
                    else
                    {
                        lblTime.ForeColor = Color.Tomato;
                        lblPhase.ForeColor = Color.Tomato;
                    }
                    this.Opacity = 0.9;
                }
            }
        }

        private void TxtPin_TextChanged(object sender, EventArgs e)
        {
            if (isLocked && !string.IsNullOrEmpty(lockPin) && txtPin.Text == lockPin)
            {
                UpdateUI("unlock");
                // Notify agent
                new Thread(() => {
                    try {
                        using (TcpClient c = new TcpClient("127.0.0.1", 49153))
                        using (NetworkStream s = c.GetStream()) {
                            byte[] data = Encoding.UTF8.GetBytes("unlock_by_pin");
                            s.Write(data, 0, data.Length);
                        }
                    } catch { }
                }).Start();
            }
        }

        private void PlaySiren()
        {
            SpeechSynthesizer synth = null;
            if (readMessage && !string.IsNullOrEmpty(currentLockMessage))
            {
                try
                {
                    synth = new SpeechSynthesizer();
                }
                catch { }
            }

            bool hasReadOnce = false;

            while (isLocked && isRunning)
            {
                if (readMessage && synth != null && (!hasReadOnce || readMessageRepeat))
                {
                    try
                    {
                        synth.Speak(currentLockMessage);
                        hasReadOnce = true;
                    }
                    catch { }
                }

                if (!isLocked || !isRunning) break;

                if (playSound)
                {
                    Console.Beep(1000, 500);
                    if (!isLocked || !isRunning) break;
                    Console.Beep(800, 500);
                }
                else
                {
                    Thread.Sleep(1000);
                }
            }

            if (synth != null)
            {
                try { synth.Dispose(); } catch { }
            }
        }

        private void SetKeyboardHook()
        {
            if (hookActive) return;
            using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
            using (var curModule = curProcess.MainModule)
            {
                _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
            }
            hookActive = true;
        }

        private void RemoveKeyboardHook()
        {
            if (!hookActive) return;
            UnhookWindowsHookEx(_hookID);
            hookActive = false;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                int vkCode = Marshal.ReadInt32(lParam);
                // Block Windows Key, Alt+Tab, Ctrl+Esc, Alt+F4
                bool alt = (Control.ModifierKeys & Keys.Alt) != 0;
                bool ctrl = (Control.ModifierKeys & Keys.Control) != 0;
                
                if (vkCode == 91 || vkCode == 92) return (IntPtr)1; // Win keys
                if (vkCode == 9 && alt) return (IntPtr)1; // Alt+Tab
                if (vkCode == 27 && ctrl) return (IntPtr)1; // Ctrl+Esc
                if (vkCode == 115 && alt) return (IntPtr)1; // Alt+F4
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (isLocked && e.CloseReason == CloseReason.UserClosing) {
                e.Cancel = true;
                return;
            }
            isRunning = false;
            if (activeReminderPopup != null)
            {
                try { activeReminderPopup.SafeClose(); } catch { }
                activeReminderPopup = null;
            }
            RemoveKeyboardHook();
            if (listener != null) listener.Stop();
            base.OnFormClosing(e);
        }

        [STAThread]
        static void Main()
        {
            try {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TimerWidget());
            } catch (Exception e) {
                System.IO.File.WriteAllText("crash.log", e.ToString());
            }
        }
    }
}
