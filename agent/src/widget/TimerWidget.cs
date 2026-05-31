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
            
            Rectangle screen = Screen.PrimaryScreen.Bounds;
            this.Location = new Point((screen.Width - this.Width) / 2, 10);

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
            lblLockMessage.Size = new Size(screen.Width, 200);
            lblLockMessage.Location = new Point(0, (screen.Height - 200) / 2 - 50);
            lblLockMessage.TextAlign = ContentAlignment.MiddleCenter;
            lblLockMessage.Visible = false;
            this.Controls.Add(lblLockMessage);

            txtPin = new TextBox();
            txtPin.Font = new Font("Segoe UI", 24, FontStyle.Bold);
            txtPin.PasswordChar = '*';
            txtPin.Size = new Size(300, 50);
            txtPin.Location = new Point((screen.Width - txtPin.Width) / 2, (screen.Height - 200) / 2 + 150);
            txtPin.TextAlign = HorizontalAlignment.Center;
            txtPin.Visible = false;
            txtPin.TextChanged += TxtPin_TextChanged;
            this.Controls.Add(txtPin);

            this.Opacity = 0;

            serverThread = new Thread(StartServer);
            serverThread.IsBackground = true;
            serverThread.Start();
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
                this.Size = new Size(200, 70);
                Rectangle screen = Screen.PrimaryScreen.Bounds;
                this.Location = new Point((screen.Width - this.Width) / 2, 10);
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

                Rectangle screen = Screen.PrimaryScreen.Bounds;
                this.Size = screen.Size;
                this.Location = new Point(0, 0);
                this.Opacity = 1;
                this.TopMost = true;

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
                    if (phase.ToLower().Contains("�����") || phase.ToLower().Contains("�������") || phase.ToLower().Contains("break"))
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
