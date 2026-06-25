using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Media;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KidsControl
{
    public class ChatData
    {
        public string Id;
        public string Name;
        public string Type;
        public string LastText;
    }

    public class ChatMsg
    {
        public string Id;
        public string Text;
        public string GifUrl;
        public string SenderName;
        public string SenderType;
        public DateTime Timestamp;
        public bool IsChild { get { return SenderType == "child"; } }
    }

    static class ChatTrayProgram
    {
        static Mutex appMutex;

        [STAThread]
        static void Main(string[] args)
        {
            bool createdNew;
            appMutex = new Mutex(true, "KidsControlChatTrayApp_v1", out createdNew);
            if (!createdNew)
            {
                appMutex.Close();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string dir = null;
            bool startMinimized = false;
            if (args != null)
            {
                foreach (string a in args)
                {
                    if (string.IsNullOrWhiteSpace(a)) continue;
                    if (a.Equals("--tray", StringComparison.OrdinalIgnoreCase))
                        startMinimized = true;
                    else if (dir == null)
                        dir = a;
                }
            }

            Application.Run(new ChatTrayApp(dir, startMinimized));
            appMutex.ReleaseMutex();
            appMutex.Close();
        }
    }

    public class ChatTrayApp : ApplicationContext
    {
        private NotifyIcon tray;
        private ChatForm window;
        private FileSystemWatcher watcher;
        private string dataPath;
        private string repliesPath;
        public string LogPath { get; private set; }

        private List<ChatData> chats = new List<ChatData>();
        private Dictionary<string, List<ChatMsg>> messages = new Dictionary<string, List<ChatMsg>>();
        private HashSet<string> seenIds = new HashSet<string>();
        private int unread = 0;
        private string activeChatId = null;
        private bool firstLoad = true;

        public ChatTrayApp(string dataDir, bool startMinimized)
        {
            string dir = dataDir;
            if (string.IsNullOrWhiteSpace(dir))
            {
                string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                dir = Path.Combine(programData, "KidsControlPC");
            }
            try { if (!Directory.Exists(dir)) Directory.CreateDirectory(dir); } catch { }
            dataPath = Path.Combine(dir, "chat_data.json");
            repliesPath = Path.Combine(dir, "chat_replies.json");
            LogPath = Path.Combine(dir, "chat_debug.log");

            tray = new NotifyIcon();
            tray.Icon = CreateIcon();
            tray.Text = "KidsControlPC — Чат";
            tray.Visible = true;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Открыть чат", null, delegate { ShowWindow(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Выход", null, delegate { Quit(); });
            tray.ContextMenuStrip = menu;
            tray.MouseClick += delegate(object s, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) ShowWindow();
            };
            tray.BalloonTipClicked += delegate { ShowWindow(); };

            if (Directory.Exists(dir))
            {
                watcher = new FileSystemWatcher(dir, "chat_data.json");
                watcher.NotifyFilter = NotifyFilters.LastWrite;
                watcher.Changed += delegate { Thread.Sleep(150); LoadData(); };
                watcher.EnableRaisingEvents = true;
            }

            LoadData();

            if (!startMinimized) ShowWindow();
        }

        public static Icon LoadAppIcon()
        {
            try
            {
                Icon ex = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (ex != null) return ex;
            }
            catch { }
            return DrawFallbackIcon();
        }

        private Icon CreateIcon()
        {
            return LoadAppIcon();
        }

        private static Icon DrawFallbackIcon()
        {
            var bmp = new Bitmap(32, 32);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                using (var b = new SolidBrush(Color.FromArgb(99, 102, 241)))
                    g.FillEllipse(b, 2, 2, 25, 22);
                var tail = new Point[] { new Point(5, 20), new Point(1, 30), new Point(13, 22) };
                using (var b = new SolidBrush(Color.FromArgb(99, 102, 241)))
                    g.FillPolygon(b, tail);
                using (var b = new SolidBrush(Color.White))
                {
                    g.FillEllipse(b, 8, 10, 4, 4);
                    g.FillEllipse(b, 13, 10, 4, 4);
                    g.FillEllipse(b, 18, 10, 4, 4);
                }
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        private void WriteLog(string msg)
        {
            try
            {
                string logPath = Path.Combine(Path.GetDirectoryName(dataPath), "chat_debug.log");
                File.AppendAllText(logPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + "\r\n", Encoding.UTF8);
            }
            catch { }
        }

        private void LoadData()
        {
            if (!File.Exists(dataPath)) { WriteLog("LoadData: file not found: " + dataPath); return; }
            string json = null;
            for (int i = 0; i < 3; i++)
            {
                try { json = File.ReadAllText(dataPath, Encoding.UTF8); break; }
                catch (IOException) { Thread.Sleep(100); }
            }
            if (string.IsNullOrWhiteSpace(json)) { WriteLog("LoadData: empty json"); return; }

            try
            {
                var ser = new JavaScriptSerializer();
                ser.MaxJsonLength = int.MaxValue;
                var root = ser.Deserialize<Dictionary<string, object>>(json);
                if (root == null) return;

                var newChats = new List<ChatData>();
                if (root.ContainsKey("chats") && root["chats"] is ArrayList)
                {
                    var ca = (ArrayList)root["chats"];
                    foreach (object raw in ca)
                    {
                        var c = raw as Dictionary<string, object>;
                        if (c == null) continue;
                        var cd = new ChatData();
                        cd.Id = Str(c, "id");
                        cd.Name = Str(c, "name") ?? "Чат";
                        cd.Type = Str(c, "type") ?? "group";
                        if (c.ContainsKey("lastMessage") && c["lastMessage"] is Dictionary<string, object>)
                        {
                            var lm = (Dictionary<string, object>)c["lastMessage"];
                            cd.LastText = Str(lm, "text");
                        }
                        if (cd.Id != null) newChats.Add(cd);
                    }
                }

                var newMsgs = new Dictionary<string, List<ChatMsg>>();
                bool hasNew = false;
                string newSender = null, newText = null;

                if (root.ContainsKey("messages") && root["messages"] is Dictionary<string, object>)
                {
                    var md = (Dictionary<string, object>)root["messages"];
                    foreach (var kv in md)
                    {
                        var list = new List<ChatMsg>();
                        if (kv.Value is ArrayList)
                        {
                            var ma = (ArrayList)kv.Value;
                            foreach (object rawM in ma)
                            {
                                var m = rawM as Dictionary<string, object>;
                                if (m == null) continue;
                                var msg = new ChatMsg();
                                msg.Id = Str(m, "id");
                                msg.Text = Str(m, "text") ?? "";
                                msg.GifUrl = Str(m, "gifUrl");
                                msg.SenderName = Str(m, "senderName") ?? "";
                                msg.SenderType = Str(m, "senderType") ?? "parent";
                                string ts = Str(m, "timestamp");
                                if (ts != null) DateTime.TryParse(ts, out msg.Timestamp);

                                if (msg.Id != null && !seenIds.Contains(msg.Id))
                                {
                                    seenIds.Add(msg.Id);
                                    if (!firstLoad && msg.SenderType == "parent")
                                    {
                                        bool winOpen = window != null && window.Visible && activeChatId == kv.Key;
                                        if (!winOpen)
                                        {
                                            hasNew = true;
                                            unread++;
                                            newSender = msg.SenderName;
                                            newText = string.IsNullOrEmpty(msg.Text) ? "[GIF]" : msg.Text;
                                        }
                                    }
                                }
                                else if (msg.Id != null)
                                {
                                    seenIds.Add(msg.Id);
                                }

                                if (msg.Id != null) list.Add(msg);
                            }
                        }
                        newMsgs[kv.Key] = list;
                    }
                }

                chats = newChats;
                messages = newMsgs;
                WriteLog("LoadData: ok, chats=" + chats.Count + " msgKeys=" + messages.Count);

                if (hasNew)
                {
                    tray.Text = "KidsControlPC (" + unread + " новых)";
                    tray.BalloonTipIcon = ToolTipIcon.Info;
                    tray.BalloonTipTitle = "KidsControlPC — новое сообщение";
                    string preview = (newText != null && newText.Length > 60) ? newText.Substring(0, 60) + "..." : newText;
                    tray.BalloonTipText = (string.IsNullOrEmpty(newSender) ? "" : newSender + ": ") + preview;
                    tray.ShowBalloonTip(6000);
                    SystemSounds.Asterisk.Play();
                }

                if (window != null && window.Visible && window.IsHandleCreated)
                    window.BeginInvoke(new Action(delegate { window.RefreshData(chats, messages); }));

                firstLoad = false;
            }
            catch (Exception ex) { WriteLog("LoadData EXCEPTION: " + ex.GetType().Name + ": " + ex.Message); }
        }

        private static string Str(Dictionary<string, object> d, string key)
        {
            return (d.ContainsKey(key) && d[key] != null) ? d[key].ToString() : null;
        }

        public void ShowWindow()
        {
            unread = 0;
            tray.Text = "KidsControlPC — Чат";

            WriteLog("ShowWindow called, chats before load=" + chats.Count);
            LoadData();
            WriteLog("ShowWindow after load, chats=" + chats.Count);

            if (window == null || window.IsDisposed)
                window = new ChatForm(this);

            window.RefreshData(chats, messages);
            window.Show();
            window.WindowState = FormWindowState.Normal;
            window.BringToFront();
            window.Activate();
            // Force repaint — Windows may skip WM_PAINT for windows that open
            // behind another window (focus-steal prevention), leaving the
            // owner-draw ListBox blank until the user interacts with it.
            window.Refresh();
        }

        public void SetActiveChat(string chatId) { activeChatId = chatId; }

        public void SendReply(string chatId, string text)
        {
            if (string.IsNullOrWhiteSpace(chatId) || string.IsNullOrWhiteSpace(text)) return;
            var ser = new JavaScriptSerializer();
            var reply = new Dictionary<string, object>();
            reply["id"] = Guid.NewGuid().ToString("N");
            reply["chatId"] = chatId;
            reply["text"] = text.Trim();
            reply["timestamp"] = DateTime.UtcNow.ToString("o");

            for (int i = 0; i < 5; i++)
            {
                try
                {
                    var list = new List<Dictionary<string, object>>();
                    if (File.Exists(repliesPath))
                    {
                        try
                        {
                            string ex = File.ReadAllText(repliesPath, Encoding.UTF8);
                            if (!string.IsNullOrWhiteSpace(ex) && ex.Trim() != "[]")
                                list = ser.Deserialize<List<Dictionary<string, object>>>(ex) ?? new List<Dictionary<string, object>>();
                        }
                        catch { }
                    }
                    list.Add(reply);
                    File.WriteAllText(repliesPath, ser.Serialize(list), Encoding.UTF8);
                    break;
                }
                catch (IOException) { Thread.Sleep(100); }
            }
        }

        private void Quit()
        {
            tray.Visible = false;
            if (watcher != null) watcher.Dispose();
            if (window != null && !window.IsDisposed) window.Close();
            Application.Exit();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                tray.Dispose();
                if (watcher != null) watcher.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    public class ChatForm : Form
    {
        private ChatTrayApp app;
        private string logPath;
        private ListBox chatList;
        private RichTextBox msgBox;
        private TextBox inputBox;
        private Label header;

        private List<ChatData> chats;
        private Dictionary<string, List<ChatMsg>> messages;
        private string selChat;

        private void Log(string msg)
        {
            try { if (logPath != null) File.AppendAllText(logPath, DateTime.Now.ToString("HH:mm:ss.fff") + " [Form] " + msg + "\r\n", Encoding.UTF8); } catch { }
        }

        public ChatForm(ChatTrayApp app)
        {
            this.app = app;
            logPath = app.LogPath;
            Text = "KidsControlPC — Чат";
            try { Icon = ChatTrayApp.LoadAppIcon(); } catch { }
            Size = new Size(700, 540);
            MinimumSize = new Size(480, 380);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(15, 17, 26);
            ShowInTaskbar = true;
            FormClosing += delegate(object s, FormClosingEventArgs e) { e.Cancel = true; Hide(); };

            BuildUI();
        }

        private void BuildUI()
        {
            // Left panel: chat list
            var left = new Panel();
            left.Dock = DockStyle.Left;
            left.Width = 195;
            left.BackColor = Color.FromArgb(20, 23, 36);

            // IMPORTANT: docking is applied in REVERSE z-order, so the Fill
            // control must be added FIRST (processed last → gets remaining
            // space). Adding it last makes it fill the whole panel and hide the
            // Top/Bottom controls (and vice-versa).
            chatList = new ListBox();
            chatList.Dock = DockStyle.Fill;
            chatList.BackColor = Color.FromArgb(28, 32, 48);
            chatList.ForeColor = Color.FromArgb(210, 220, 240);
            chatList.BorderStyle = BorderStyle.None;
            chatList.Font = new Font("Segoe UI", 10);
            chatList.ItemHeight = 32;
            chatList.IntegralHeight = false;
            chatList.SelectedIndexChanged += OnChatSelected;
            left.Controls.Add(chatList);

            var listTitle = new Label();
            listTitle.Text = "Чаты";
            listTitle.Font = new Font("Segoe UI", 11, FontStyle.Bold);
            listTitle.ForeColor = Color.White;
            listTitle.Dock = DockStyle.Top;
            listTitle.Height = 40;
            listTitle.TextAlign = ContentAlignment.MiddleLeft;
            listTitle.Padding = new Padding(12, 0, 0, 0);
            left.Controls.Add(listTitle);

            Controls.Add(left);

            // Separator
            var sep = new Panel();
            sep.Dock = DockStyle.Left;
            sep.Width = 1;
            sep.BackColor = Color.FromArgb(38, 43, 62);
            Controls.Add(sep);

            // Right panel
            var right = new Panel();
            right.Dock = DockStyle.Fill;
            right.BackColor = Color.FromArgb(15, 17, 26);

            // Fill control added FIRST (see note above), then edge controls.
            msgBox = new RichTextBox();
            msgBox.Dock = DockStyle.Fill;
            msgBox.BackColor = Color.FromArgb(15, 17, 26);
            msgBox.ForeColor = Color.FromArgb(200, 210, 230);
            msgBox.Font = new Font("Segoe UI", 10);
            msgBox.ReadOnly = true;
            msgBox.BorderStyle = BorderStyle.None;
            msgBox.Padding = new Padding(8);
            right.Controls.Add(msgBox);

            // Input panel (Bottom)
            var inputPanel = new Panel();
            inputPanel.Dock = DockStyle.Bottom;
            inputPanel.Height = 56;
            inputPanel.BackColor = Color.FromArgb(20, 23, 36);
            inputPanel.Padding = new Padding(10, 10, 10, 10);

            inputBox = new TextBox();
            inputBox.BackColor = Color.FromArgb(30, 34, 52);
            inputBox.ForeColor = Color.FromArgb(215, 225, 240);
            inputBox.Font = new Font("Segoe UI", 10);
            inputBox.BorderStyle = BorderStyle.None;
            inputBox.Location = new Point(10, 12);
            inputBox.Size = new Size(570, 32);
            inputBox.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            inputBox.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; TrySend(); }
            };
            inputPanel.Controls.Add(inputBox);

            var sendBtn = new Button();
            sendBtn.Text = ">";
            sendBtn.Font = new Font("Segoe UI", 13, FontStyle.Bold);
            sendBtn.Size = new Size(44, 32);
            sendBtn.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            sendBtn.Location = new Point(inputPanel.Width - 54, 12);
            sendBtn.BackColor = Color.FromArgb(99, 102, 241);
            sendBtn.ForeColor = Color.White;
            sendBtn.FlatStyle = FlatStyle.Flat;
            sendBtn.FlatAppearance.BorderSize = 0;
            sendBtn.Cursor = Cursors.Hand;
            sendBtn.Click += delegate { TrySend(); };
            inputPanel.Controls.Add(sendBtn);

            inputPanel.Resize += delegate
            {
                inputBox.Width = inputPanel.Width - 74;
                sendBtn.Location = new Point(inputPanel.Width - 54, 12);
            };

            right.Controls.Add(inputPanel);

            var hline = new Panel();
            hline.Dock = DockStyle.Top;
            hline.Height = 1;
            hline.BackColor = Color.FromArgb(38, 43, 62);
            right.Controls.Add(hline);

            header = new Label();
            header.Text = "Выберите чат";
            header.Font = new Font("Segoe UI", 11, FontStyle.Bold);
            header.ForeColor = Color.White;
            header.Dock = DockStyle.Top;
            header.Height = 42;
            header.TextAlign = ContentAlignment.MiddleLeft;
            header.Padding = new Padding(14, 0, 0, 0);
            right.Controls.Add(header);

            Controls.Add(right);
        }

        private void OnChatSelected(object sender, EventArgs e)
        {
            if (chats == null || chatList.SelectedIndex < 0 || chatList.SelectedIndex >= chats.Count) return;
            var c = chats[chatList.SelectedIndex];
            selChat = c.Id;
            app.SetActiveChat(selChat);
            header.Text = c.Name;
            RenderMessages();
        }

        private void RenderMessages()
        {
            msgBox.Clear();
            List<ChatMsg> list = null;
            if (selChat != null && messages != null)
                messages.TryGetValue(selChat, out list);

            if (list == null || list.Count == 0)
            {
                msgBox.SelectionColor = Color.FromArgb(100, 115, 140);
                msgBox.AppendText("Нет сообщений. Напишите первым!\n");
                return;
            }

            string lastDate = null;
            var ruCulture = new System.Globalization.CultureInfo("ru-RU");

            foreach (var m in list)
            {
                if (m.Timestamp != DateTime.MinValue)
                {
                    string d = m.Timestamp.ToLocalTime().ToString("d MMMM", ruCulture);
                    if (d != lastDate)
                    {
                        lastDate = d;
                        msgBox.SelectionAlignment = HorizontalAlignment.Center;
                        msgBox.SelectionColor = Color.FromArgb(85, 100, 125);
                        msgBox.SelectionFont = new Font("Segoe UI", 8f);
                        msgBox.AppendText("\n── " + d + " ──\n\n");
                    }
                }

                bool mine = m.IsChild;
                string time = m.Timestamp != DateTime.MinValue ? m.Timestamp.ToLocalTime().ToString("HH:mm") : "";
                string body = !string.IsNullOrEmpty(m.Text) ? m.Text : (!string.IsNullOrEmpty(m.GifUrl) ? "[GIF]" : "");

                if (mine)
                {
                    msgBox.SelectionAlignment = HorizontalAlignment.Right;
                    msgBox.SelectionColor = Color.FromArgb(115, 130, 155);
                    msgBox.SelectionFont = new Font("Segoe UI", 8.5f);
                    msgBox.AppendText("Вы\n");
                    msgBox.SelectionAlignment = HorizontalAlignment.Right;
                    msgBox.SelectionColor = Color.FromArgb(165, 172, 255);
                    msgBox.SelectionFont = new Font("Segoe UI", 10);
                    msgBox.AppendText(body);
                }
                else
                {
                    msgBox.SelectionAlignment = HorizontalAlignment.Left;
                    msgBox.SelectionColor = Color.FromArgb(115, 130, 155);
                    msgBox.SelectionFont = new Font("Segoe UI", 8.5f);
                    msgBox.AppendText((string.IsNullOrEmpty(m.SenderName) ? "Родитель" : m.SenderName) + "\n");
                    msgBox.SelectionAlignment = HorizontalAlignment.Left;
                    msgBox.SelectionColor = Color.FromArgb(215, 225, 240);
                    msgBox.SelectionFont = new Font("Segoe UI", 10);
                    msgBox.AppendText(body);
                }

                msgBox.SelectionColor = Color.FromArgb(85, 100, 125);
                msgBox.SelectionFont = new Font("Segoe UI", 7.5f);
                msgBox.AppendText("  " + time + "\n\n");
            }

            msgBox.SelectionStart = msgBox.Text.Length;
            msgBox.ScrollToCaret();
        }

        private void TrySend()
        {
            if (selChat == null)
            {
                MessageBox.Show("Выберите чат.", "KidsControlPC", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string t = inputBox.Text.Trim();
            if (string.IsNullOrEmpty(t)) return;
            inputBox.Clear();
            app.SendReply(selChat, t);
        }

        public void RefreshData(List<ChatData> newChats, Dictionary<string, List<ChatMsg>> newMsgs)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(delegate { RefreshData(newChats, newMsgs); }));
                return;
            }
            chats = newChats;
            messages = newMsgs;
            Log("RefreshData: chats=" + (chats != null ? chats.Count.ToString() : "null") + " InvokeRequired=" + InvokeRequired);

            int prev = chatList.SelectedIndex;
            chatList.Items.Clear();
            if (chats != null)
                foreach (var c in chats)
                    chatList.Items.Add(c.Name);
            Log("RefreshData: chatList.Items.Count=" + chatList.Items.Count);

            if (selChat != null && chats != null)
            {
                int idx = chats.FindIndex(delegate(ChatData c) { return c.Id == selChat; });
                if (idx >= 0) chatList.SelectedIndex = idx;
            }
            else if (prev >= 0 && chatList.Items.Count > prev)
            {
                chatList.SelectedIndex = prev;
            }

            RenderMessages();
        }
    }
}
