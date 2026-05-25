using System;
using System.Drawing;
using System.Windows.Forms;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace KidsControl
{
    public class TimerWidget : Form
    {
        private Label lblTime;
        private Label lblPhase;
        private TcpListener listener;
        private Thread serverThread;
        private bool isRunning = true;

        public TimerWidget()
        {
            // Setup Window
            this.FormBorderStyle = FormBorderStyle.None;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.BackColor = Color.Black;
            this.TransparencyKey = Color.Black; // Make background transparent
            this.StartPosition = FormStartPosition.Manual;
            this.Size = new Size(200, 70);
            
            // Position at top center
            Rectangle screen = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point((screen.Width - this.Width) / 2, 10);

            // Setup UI Elements
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

            // Initially hidden
            this.Opacity = 0;

            // Start TCP Server
            serverThread = new Thread(StartServer);
            serverThread.IsBackground = true;
            serverThread.Start();
        }

        private void StartServer()
        {
            try
            {
                // Port 49152 is start of dynamic ports
                listener = new TcpListener(IPAddress.Loopback, 49152);
                listener.Start();

                while (isRunning)
                {
                    if (listener.Pending())
                    {
                        using (TcpClient client = listener.AcceptTcpClient())
                        using (NetworkStream stream = client.GetStream())
                        {
                            byte[] buffer = new byte[1024];
                            int bytesRead = stream.Read(buffer, 0, buffer.Length);
                            string message = Encoding.UTF8.GetString(buffer, 0, bytesRead).Trim();
                            
                            // Expected format: "show|Work|25:00" or "hide"
                            UpdateUI(message);
                        }
                    }
                    Thread.Sleep(100);
                }
            }
            catch (Exception)
            {
                // Ignore socket exceptions on shutdown
            }
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
                this.Opacity = 0;
            }
            else if (message.StartsWith("show|"))
            {
                string[] parts = message.Split('|');
                if (parts.Length == 3)
                {
                    string phase = parts[1];
                    string time = parts[2];

                    lblPhase.Text = phase;
                    lblTime.Text = time;

                    if (phase.ToLower().Contains("отдых") || phase.ToLower().Contains("перерыв") || phase.ToLower().Contains("break"))
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

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            isRunning = false;
            if (listener != null)
                listener.Stop();
            base.OnFormClosing(e);
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TimerWidget());
        }
    }
}
