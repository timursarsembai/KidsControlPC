using System;
using System.Drawing;
using System.Windows.Forms;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Speech.Synthesis;

namespace KidsControl
{
    public class ReminderWidget : Form
    {
        private readonly string reminderId = "";
        private readonly bool voiceLoop = false;
        private Label lblMessage;
        private Button btnDismiss;
        private Button btnStopVoice;
        private Thread voiceThread;
        private SpeechSynthesizer synth;
        private volatile bool isRunning = true;

        public ReminderWidget(string id, string message, bool loop)
        {
            reminderId = id ?? "";
            voiceLoop = loop;

            Text = "Напоминание";
            FormBorderStyle = FormBorderStyle.None;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(430, 230);
            TopMost = true;
            ShowInTaskbar = false;
            BackColor = Color.FromArgb(24, 28, 38);
            ForeColor = Color.White;

            Label title = new Label();
            title.Text = "Напоминание";
            title.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.Location = new Point(18, 14);
            title.Size = new Size(320, 26);
            Controls.Add(title);

            Button closeButton = new Button();
            closeButton.Text = "x";
            closeButton.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            closeButton.Size = new Size(30, 28);
            closeButton.Location = new Point(Width - 44, 12);
            closeButton.FlatStyle = FlatStyle.Flat;
            closeButton.FlatAppearance.BorderSize = 0;
            closeButton.BackColor = Color.Transparent;
            closeButton.ForeColor = Color.FromArgb(150, 160, 180);
            closeButton.Cursor = Cursors.Hand;
            closeButton.Click += BtnDismiss_Click;
            Controls.Add(closeButton);

            lblMessage = new Label();
            lblMessage.Text = string.IsNullOrWhiteSpace(message) ? "Напоминание" : message;
            lblMessage.Font = new Font("Segoe UI", 13, FontStyle.Regular);
            lblMessage.ForeColor = Color.FromArgb(226, 232, 240);
            lblMessage.TextAlign = ContentAlignment.MiddleLeft;
            lblMessage.Location = new Point(18, 52);
            lblMessage.Size = new Size(394, 92);
            Controls.Add(lblMessage);

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
            btnStopVoice.Click += BtnStopVoice_Click;
            Controls.Add(btnStopVoice);

            btnDismiss = new Button();
            btnDismiss.Text = "Понятно";
            btnDismiss.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            btnDismiss.Size = new Size(136, 40);
            btnDismiss.Location = new Point(Width - btnDismiss.Width - 18, 166);
            btnDismiss.BackColor = Color.FromArgb(99, 102, 241);
            btnDismiss.ForeColor = Color.White;
            btnDismiss.FlatStyle = FlatStyle.Flat;
            btnDismiss.FlatAppearance.BorderSize = 0;
            btnDismiss.Cursor = Cursors.Hand;
            btnDismiss.Click += BtnDismiss_Click;
            Controls.Add(btnDismiss);

            FormClosing += ReminderWidget_FormClosing;
            Shown += (s, e) =>
            {
                PositionBottomRight();
                BringToFront();
                Activate();
                btnDismiss.Focus();
            };

            if (voiceLoop)
            {
                voiceThread = new Thread(() => PlayVoiceLoop(lblMessage.Text));
                voiceThread.IsBackground = true;
                voiceThread.Start();
            }
        }

        private void PositionBottomRight()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int margin = 18;
            Location = new Point(area.Right - Width - margin, area.Bottom - Height - margin);
        }

        private void PlayVoiceLoop(string msg)
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
                            synth.SpeakAsync(msg);
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

        private void BtnStopVoice_Click(object sender, EventArgs e)
        {
            StopVoice();
        }

        private void BtnDismiss_Click(object sender, EventArgs e)
        {
            StopVoice();
            NotifyAgentDismissed();
            Close();
        }

        private void ReminderWidget_FormClosing(object sender, FormClosingEventArgs e)
        {
            StopVoice();
        }

        private void NotifyAgentDismissed()
        {
            new Thread(() =>
            {
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

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args.Length < 3) return;

            string id = args[0];
            string message = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
            bool voiceLoop = args[2] == "1";

            Application.Run(new ReminderWidget(id, message, voiceLoop));
        }
    }
}
