using System;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.Speech.Synthesis;

namespace KidsControl
{
    public class ScreenBlockerWidget : Form
    {
        private Label lblMessage;
        private Label lblTimer;
        private int durationSeconds;
        private string warningMessage;
        private bool isRunning = true;
        private Thread voiceThread;
        private System.Windows.Forms.Timer countdownTimer;

        public ScreenBlockerWidget(string message, int durationSeconds)
        {
            this.warningMessage = message;
            this.durationSeconds = durationSeconds;

            this.Text = "Экран заблокирован";
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.WindowState = FormWindowState.Normal;
            this.TopMost = true;
            this.BackColor = Color.DarkRed;
            this.ShowInTaskbar = false;
            ApplyVirtualScreenBounds();

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 1;
            layout.RowCount = 3;
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 30F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 40F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 30F));
            this.Controls.Add(layout);

            Label lblWarningIcon = new Label();
            lblWarningIcon.Text = "🛑";
            lblWarningIcon.Font = new Font("Segoe UI Emoji", 72, FontStyle.Regular);
            lblWarningIcon.ForeColor = Color.White;
            lblWarningIcon.TextAlign = ContentAlignment.BottomCenter;
            lblWarningIcon.Dock = DockStyle.Fill;
            layout.Controls.Add(lblWarningIcon, 0, 0);

            lblMessage = new Label();
            lblMessage.Text = warningMessage;
            lblMessage.Font = new Font("Segoe UI", 36, FontStyle.Bold);
            lblMessage.ForeColor = Color.White;
            lblMessage.TextAlign = ContentAlignment.MiddleCenter;
            lblMessage.Dock = DockStyle.Fill;
            layout.Controls.Add(lblMessage, 0, 1);

            lblTimer = new Label();
            lblTimer.Text = string.Format("Разблокировка через {0} сек...", durationSeconds);
            lblTimer.Font = new Font("Segoe UI", 24, FontStyle.Regular);
            lblTimer.ForeColor = Color.LightCoral;
            lblTimer.TextAlign = ContentAlignment.TopCenter;
            lblTimer.Dock = DockStyle.Fill;
            layout.Controls.Add(lblTimer, 0, 2);

            this.FormClosing += ScreenBlockerWidget_FormClosing;

            countdownTimer = new System.Windows.Forms.Timer();
            countdownTimer.Interval = 1000;
            countdownTimer.Tick += CountdownTimer_Tick;
            countdownTimer.Start();

            voiceThread = new Thread(() => PlaySirenAndVoice(warningMessage));
            voiceThread.IsBackground = true;
            voiceThread.Start();
        }

        private void ApplyVirtualScreenBounds()
        {
            this.Bounds = SystemInformation.VirtualScreen;
        }

        private void CountdownTimer_Tick(object sender, EventArgs e)
        {
            durationSeconds--;
            if (durationSeconds > 0)
            {
                lblTimer.Text = string.Format("Разблокировка через {0} сек...", durationSeconds);
                ApplyVirtualScreenBounds();
                this.TopMost = true; // enforce topmost
                this.BringToFront();
            }
            else
            {
                countdownTimer.Stop();
                isRunning = false;
                this.Close();
            }
        }

        private void PlaySirenAndVoice(string msg)
        {
            using (SpeechSynthesizer synth = new SpeechSynthesizer())
            {
                synth.SetOutputToDefaultAudioDevice();
                while (isRunning)
                {
                    // Synthetic siren
                    Console.Beep(800, 300);
                    Console.Beep(600, 300);
                    Console.Beep(800, 300);
                    Console.Beep(600, 300);
                    
                    if (isRunning)
                    {
                        synth.Speak(msg);
                    }
                    Thread.Sleep(1000);
                }
            }
        }

        private void ScreenBlockerWidget_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (isRunning)
            {
                e.Cancel = true; // Prevent closing via Alt+F4
            }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            // Block common shortcuts if focused
            if (keyData == (Keys.Alt | Keys.F4) || 
                keyData == (Keys.Alt | Keys.Tab) || 
                keyData == (Keys.Control | Keys.Escape))
            {
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            if (args.Length < 2) return;
            
            // Expected args: "Base64 Message" "DurationSeconds"
            string message = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(args[0]));
            int duration;
            if (!int.TryParse(args[1], out duration)) {
                duration = 30;
            }

            Application.Run(new ScreenBlockerWidget(message, duration));
        }
    }
}
