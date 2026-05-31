using System;
using System.Drawing;
using System.Windows.Forms;
using System.Text;

namespace KidsControl
{
    public class CustomDialogWidget : Form
    {
        private Label lblTitle;
        private Label lblMessage;
        private TextBox txtInput;
        private Button btnOk;
        private Button btnCancel;
        private string resultText = "";
        
        // Args: Title, Message, RequireInput (bool)
        public CustomDialogWidget(string title, string message, bool requireInput)
        {
            this.Text = title;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(450, requireInput ? 250 : 200);
            this.TopMost = true;
            this.BackColor = Color.White;

            lblTitle = new Label();
            lblTitle.Text = title;
            lblTitle.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            lblTitle.ForeColor = Color.DarkSlateBlue;
            lblTitle.Dock = DockStyle.Top;
            lblTitle.TextAlign = ContentAlignment.MiddleCenter;
            lblTitle.Height = 50;
            this.Controls.Add(lblTitle);

            lblMessage = new Label();
            lblMessage.Text = message;
            lblMessage.Font = new Font("Segoe UI", 11, FontStyle.Regular);
            lblMessage.Dock = DockStyle.Top;
            lblMessage.TextAlign = ContentAlignment.MiddleCenter;
            lblMessage.Height = 60;
            this.Controls.Add(lblMessage);

            if (requireInput)
            {
                txtInput = new TextBox();
                txtInput.Font = new Font("Segoe UI", 14, FontStyle.Regular);
                txtInput.Width = 300;
                txtInput.Location = new Point((this.ClientSize.Width - txtInput.Width) / 2, lblTitle.Height + lblMessage.Height + 10);
                txtInput.TextAlign = HorizontalAlignment.Center;
                this.Controls.Add(txtInput);
            }

            Panel bottomPanel = new Panel();
            bottomPanel.Height = 60;
            bottomPanel.Dock = DockStyle.Bottom;
            bottomPanel.BackColor = Color.WhiteSmoke;
            this.Controls.Add(bottomPanel);

            int btnWidth = 100;
            int btnSpacing = 20;
            int totalBtnWidth = requireInput ? (btnWidth * 2 + btnSpacing) : btnWidth;

            btnOk = new Button();
            btnOk.Text = "OK";
            btnOk.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            btnOk.Size = new Size(btnWidth, 35);
            btnOk.Location = new Point((this.ClientSize.Width - totalBtnWidth) / 2, 12);
            btnOk.BackColor = Color.DodgerBlue;
            btnOk.ForeColor = Color.White;
            btnOk.FlatStyle = FlatStyle.Flat;
            btnOk.Cursor = Cursors.Hand;
            btnOk.Click += (s, e) => {
                if (requireInput) resultText = txtInput.Text;
                else resultText = "OK";
                this.DialogResult = DialogResult.OK;
                this.Close();
            };
            bottomPanel.Controls.Add(btnOk);

            if (requireInput)
            {
                btnCancel = new Button();
                btnCancel.Text = "Отмена / Cancel";
                btnCancel.Font = new Font("Segoe UI", 10, FontStyle.Regular);
                btnCancel.Size = new Size(btnWidth + 40, 35);
                btnCancel.Location = new Point(btnOk.Right + btnSpacing, 12);
                btnCancel.BackColor = Color.LightGray;
                btnCancel.FlatStyle = FlatStyle.Flat;
                btnCancel.Cursor = Cursors.Hand;
                btnCancel.Click += (s, e) => {
                    resultText = "CANCEL";
                    this.DialogResult = DialogResult.Cancel;
                    this.Close();
                };
                bottomPanel.Controls.Add(btnCancel);
                
                this.AcceptButton = btnOk;
                this.CancelButton = btnCancel;
                
                this.Shown += (s, e) => txtInput.Focus();
            }
        }

        public string GetResult() { return resultText; }

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            if (args.Length < 3) return;
            
            string title = Encoding.UTF8.GetString(Convert.FromBase64String(args[0]));
            string message = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
            bool requireInput = args[2] == "1";

            var dialog = new CustomDialogWidget(title, message, requireInput);
            if (dialog.ShowDialog() == DialogResult.OK)
            {
                Console.Write(dialog.GetResult());
            }
            else
            {
                Console.Write(""); // Empty string on cancel
            }
        }
    }
}
