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
        private Label lblMessage;
        private Button btnDismiss;
        private string reminderId = "";
        private bool voiceLoop = false;
        private Thread voiceThread;
        private bool isRunning = true;

        public ReminderWidget(string id, string message, bool loop)
        {
            this.reminderId = id;
            this.voiceLoop = loop;
            
            this.Text = "Напоминание";
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(500, 300);
            this.TopMost = true;
            this.BackColor = Color.White;

            lblMessage = new Label();
            lblMessage.Text = message;
            lblMessage.Font = new Font("Segoe UI", 16, FontStyle.Regular);
            lblMessage.TextAlign = ContentAlignment.MiddleCenter;
            lblMessage.Dock = DockStyle.Fill;
            lblMessage.Padding = new Padding(20);
            this.Controls.Add(lblMessage);

            Panel bottomPanel = new Panel();
            bottomPanel.Height = 60;
            bottomPanel.Dock = DockStyle.Bottom;
            bottomPanel.BackColor = Color.WhiteSmoke;
            this.Controls.Add(bottomPanel);

            btnDismiss = new Button();
            btnDismiss.Text = "Отключить";
            btnDismiss.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            btnDismiss.Size = new Size(150, 40);
            btnDismiss.Location = new Point((this.Width - 150) / 2 - 8, 10);
            btnDismiss.BackColor = Color.Tomato;
            btnDismiss.ForeColor = Color.White;
            btnDismiss.FlatStyle = FlatStyle.Flat;
            btnDismiss.Cursor = Cursors.Hand;
            btnDismiss.Click += BtnDismiss_Click;
            bottomPanel.Controls.Add(btnDismiss);

            this.FormClosing += ReminderWidget_FormClosing;

            if (voiceLoop)
            {
                voiceThread = new Thread(() => PlayVoiceLoop(message));
                voiceThread.IsBackground = true;
                voiceThread.Start();
            }
        }

        private void PlayVoiceLoop(string msg)
        {
            using (SpeechSynthesizer synth = new SpeechSynthesizer())
            {
                synth.SetOutputToDefaultAudioDevice();
                while (isRunning)
                {
                    synth.Speak(msg);
                    Thread.Sleep(1000);
                }
            }
        }

        private void BtnDismiss_Click(object sender, EventArgs e)
        {
            isRunning = false;
            NotifyAgentDismissed();
            this.Close();
        }

        private void ReminderWidget_FormClosing(object sender, FormClosingEventArgs e)
        {
            isRunning = false;
        }

        private void NotifyAgentDismissed()
        {
            new Thread(() => {
                try {
                    using (TcpClient c = new TcpClient("127.0.0.1", 49153))
                    using (NetworkStream s = c.GetStream()) {
                        byte[] data = Encoding.UTF8.GetBytes("reminder_dismissed|" + reminderId);
                        s.Write(data, 0, data.Length);
                    }
                } catch { }
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
