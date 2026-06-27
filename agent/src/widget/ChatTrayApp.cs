using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Media;
using System.Text;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

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
        public string GifPreviewUrl;
        public string FileUrl;
        public string FileName;
        public long FileSize;
        public string MimeType;
        public bool FileDeleted;
        public string SenderName;
        public string SenderType;
        public string Status;       // 'sent' | 'delivered' | 'read' (for child's own messages)
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
            if (!createdNew) { appMutex.Close(); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string dir = null;
            bool startMinimized = false;
            if (args != null)
            {
                foreach (string a in args)
                {
                    if (string.IsNullOrWhiteSpace(a)) continue;
                    if (a.Equals("--tray", StringComparison.OrdinalIgnoreCase)) startMinimized = true;
                    else if (dir == null) dir = a;
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
        private HashSet<string> persistedSeenIds = new HashSet<string>();
        private string seenPath;
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
            seenPath = Path.Combine(dir, "chat_seen.json");
            LoadSeenIds();

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
            try { Icon ex = Icon.ExtractAssociatedIcon(Application.ExecutablePath); if (ex != null) return ex; } catch { }
            return DrawFallbackIcon();
        }

        private Icon CreateIcon() { return LoadAppIcon(); }

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
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + "\r\n", Encoding.UTF8); } catch { }
        }

        private void LoadData()
        {
            if (!File.Exists(dataPath)) return;
            string json = null;
            for (int i = 0; i < 3; i++)
            {
                try { json = File.ReadAllText(dataPath, Encoding.UTF8); break; }
                catch (IOException) { Thread.Sleep(100); }
            }
            if (string.IsNullOrWhiteSpace(json)) return;

            try
            {
                var ser = new JavaScriptSerializer();
                ser.MaxJsonLength = int.MaxValue;
                var root = ser.Deserialize<Dictionary<string, object>>(json);
                if (root == null) return;

                var newChats = new List<ChatData>();
                if (root.ContainsKey("chats") && root["chats"] is ArrayList)
                {
                    foreach (object raw in (ArrayList)root["chats"])
                    {
                        var c = raw as Dictionary<string, object>;
                        if (c == null) continue;
                        var cd = new ChatData();
                        cd.Id = Str(c, "id");
                        cd.Name = Str(c, "name") ?? "Чат";
                        cd.Type = Str(c, "type") ?? "group";
                        if (c.ContainsKey("lastMessage") && c["lastMessage"] is Dictionary<string, object>)
                            cd.LastText = Str((Dictionary<string, object>)c["lastMessage"], "text");
                        if (cd.Id != null) newChats.Add(cd);
                    }
                }

                var newMsgs = new Dictionary<string, List<ChatMsg>>();
                bool hasNew = false;
                string newSender = null, newText = null;

                if (root.ContainsKey("messages") && root["messages"] is Dictionary<string, object>)
                {
                    foreach (var kv in (Dictionary<string, object>)root["messages"])
                    {
                        var list = new List<ChatMsg>();
                        if (kv.Value is ArrayList)
                        {
                            foreach (object rawM in (ArrayList)kv.Value)
                            {
                                var m = rawM as Dictionary<string, object>;
                                if (m == null) continue;
                                var msg = new ChatMsg();
                                msg.Id = Str(m, "id");
                                msg.Text = Str(m, "text") ?? "";
                                msg.GifUrl = Str(m, "gifUrl");
                                msg.GifPreviewUrl = Str(m, "gifPreviewUrl");
                                msg.FileUrl = Str(m, "fileUrl");
                                msg.FileName = Str(m, "fileName");
                                msg.MimeType = Str(m, "mimeType");
                                msg.FileDeleted = m.ContainsKey("fileDeleted") && m["fileDeleted"] is bool && (bool)m["fileDeleted"];
                                if (m.ContainsKey("fileSize") && m["fileSize"] != null)
                                    long.TryParse(m["fileSize"].ToString(), out msg.FileSize);
                                msg.SenderName = Str(m, "senderName") ?? "";
                                msg.SenderType = Str(m, "senderType") ?? "parent";
                                msg.Status = Str(m, "status") ?? "sent";
                                string ts = Str(m, "timestamp");
                                if (ts != null) DateTime.TryParse(ts, out msg.Timestamp);

                                if (msg.Id != null && !seenIds.Contains(msg.Id))
                                {
                                    seenIds.Add(msg.Id);
                                    if (msg.SenderType == "parent")
                                    {
                                        bool winOpen = window != null && window.Visible && activeChatId == kv.Key;
                                        if (!winOpen)
                                        {
                                            bool shouldNotify;
                                            if (!firstLoad)
                                            {
                                                // Live update — always notify
                                                shouldNotify = true;
                                            }
                                            else
                                            {
                                                // Startup: notify only for messages not seen last
                                                // session AND received within the past 24 hours
                                                // (avoids flood of old history on first install).
                                                bool isNew = !persistedSeenIds.Contains(msg.Id);
                                                bool isRecent = msg.Timestamp != DateTime.MinValue &&
                                                    (DateTime.UtcNow - msg.Timestamp.ToUniversalTime()).TotalHours < 24;
                                                shouldNotify = isNew && isRecent;
                                            }
                                            if (shouldNotify)
                                            {
                                                hasNew = true;
                                                unread++;
                                                newSender = msg.SenderName;
                                                newText = !string.IsNullOrEmpty(msg.Text) ? msg.Text : (!string.IsNullOrEmpty(msg.FileName) ? "[Файл: " + msg.FileName + "]" : "[GIF]");
                                            }
                                        }
                                    }
                                }
                                else if (msg.Id != null) seenIds.Add(msg.Id);

                                if (msg.Id != null) list.Add(msg);
                            }
                        }
                        newMsgs[kv.Key] = list;
                    }
                }

                chats = newChats;
                messages = newMsgs;

                if (hasNew)
                {
                    tray.Text = "KidsControlPC (" + unread + " новых)";
                    tray.BalloonTipIcon = ToolTipIcon.Info;
                    tray.BalloonTipTitle = "KidsControlPC — новое сообщение";
                    string preview = StripEmoji(newText ?? "");
                    if (preview.Length > 60) preview = preview.Substring(0, 60) + "...";
                    string sender = StripEmoji(newSender ?? "");
                    tray.BalloonTipText = (string.IsNullOrEmpty(sender) ? "" : sender + ": ") + preview;
                    tray.ShowBalloonTip(6000);
                    SystemSounds.Asterisk.Play();
                }

                if (window != null && window.Visible && window.IsHandleCreated)
                    window.BeginInvoke(new Action(delegate { window.RefreshData(chats, messages); }));

                firstLoad = false;
                SaveSeenIds();
            }
            catch (Exception ex) { WriteLog("LoadData EXCEPTION: " + ex.GetType().Name + ": " + ex.Message); }
        }

        // Remove surrogate pairs (emoji above U+FFFF) and common emoji ranges
        // so Windows balloon tips don't show □ placeholders.
        private static string StripEmoji(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            var sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (char.IsHighSurrogate(c)) { i++; continue; } // skip surrogate pair
                int cp = (int)c;
                // Skip common emoji/symbol blocks in BMP
                if ((cp >= 0x2190 && cp <= 0x27FF) ||  // arrows, misc symbols, dingbats
                    (cp >= 0x2B00 && cp <= 0x2BFF) ||  // misc symbols and arrows
                    (cp >= 0xFE00 && cp <= 0xFE0F) ||  // variation selectors
                    cp == 0x200D)                         // zero-width joiner
                    continue;
                sb.Append(c);
            }
            return sb.ToString().Trim();
        }

        private void LoadSeenIds()
        {
            if (!File.Exists(seenPath)) return;
            try
            {
                var ser = new JavaScriptSerializer();
                var list = ser.Deserialize<List<string>>(File.ReadAllText(seenPath, Encoding.UTF8));
                if (list != null)
                    foreach (var id in list) { seenIds.Add(id); persistedSeenIds.Add(id); }
            }
            catch { }
        }

        private void SaveSeenIds()
        {
            try
            {
                var list = new List<string>(seenIds);
                if (list.Count > 2000) list = list.GetRange(list.Count - 2000, 2000);
                File.WriteAllText(seenPath, new JavaScriptSerializer().Serialize(list), Encoding.UTF8);
            }
            catch { }
        }

        private static string Str(Dictionary<string, object> d, string key)
        {
            return (d.ContainsKey(key) && d[key] != null) ? d[key].ToString() : null;
        }

        public void ShowWindow()
        {
            unread = 0;
            tray.Text = "KidsControlPC — Чат";
            LoadData();

            if (window == null || window.IsDisposed)
                window = new ChatForm(this);

            window.RefreshData(chats, messages);
            window.Show();
            window.WindowState = FormWindowState.Normal;
            window.BringToFront();
            window.Activate();
        }

        public void SetActiveChat(string chatId) { activeChatId = chatId; }

        public void SendReadReceipt(string chatId)
        {
            if (string.IsNullOrWhiteSpace(chatId)) return;
            var ser = new JavaScriptSerializer();
            var reply = new Dictionary<string, object>();
            reply["id"] = Guid.NewGuid().ToString("N");
            reply["chatId"] = chatId;
            reply["markRead"] = true;
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
                    // Collapse duplicate pending read receipts for the same chat.
                    list.RemoveAll(x => x != null && x.ContainsKey("markRead") && x.ContainsKey("chatId") && x["chatId"] != null && x["chatId"].ToString() == chatId);
                    list.Add(reply);
                    File.WriteAllText(repliesPath, ser.Serialize(list), Encoding.UTF8);
                    break;
                }
                catch (IOException) { Thread.Sleep(100); }
            }
        }

        public void SendReply(string chatId, string text)
        {
            if (string.IsNullOrWhiteSpace(chatId) || string.IsNullOrWhiteSpace(text)) return;
            WriteLog("SendReply chatId=" + chatId + " text=" + text);
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

        public void SendFileReply(string chatId, string filePath, string fileName, long fileSize, string mimeType)
        {
            if (string.IsNullOrWhiteSpace(chatId) || string.IsNullOrWhiteSpace(filePath)) return;
            WriteLog("SendFileReply chatId=" + chatId + " file=" + fileName + " size=" + fileSize);
            var ser = new JavaScriptSerializer();
            var reply = new Dictionary<string, object>();
            reply["id"] = Guid.NewGuid().ToString("N");
            reply["chatId"] = chatId;
            reply["filePath"] = filePath;
            reply["fileName"] = fileName ?? "";
            reply["fileSize"] = fileSize;
            reply["mimeType"] = mimeType ?? "application/octet-stream";
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

        public void SendGifReply(string chatId, string gifUrl, string gifPreviewUrl)
        {
            if (string.IsNullOrWhiteSpace(chatId) || string.IsNullOrWhiteSpace(gifUrl)) return;
            WriteLog("SendGifReply chatId=" + chatId + " gif=" + gifUrl);
            var ser = new JavaScriptSerializer();
            var reply = new Dictionary<string, object>();
            reply["id"] = Guid.NewGuid().ToString("N");
            reply["chatId"] = chatId;
            reply["gifUrl"] = gifUrl;
            reply["gifPreviewUrl"] = string.IsNullOrEmpty(gifPreviewUrl) ? gifUrl : gifPreviewUrl;
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
            if (disposing) { tray.Dispose(); if (watcher != null) watcher.Dispose(); }
            base.Dispose(disposing);
        }
    }

    public class ChatForm : Form
    {
        private ChatTrayApp app;
        private WebView2 webView;
        private bool webViewReady = false;
        private List<ChatData> pendingChats;
        private Dictionary<string, List<ChatMsg>> pendingMessages;

        private void Log(string msg)
        {
            try { File.AppendAllText(app.LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " [Form] " + msg + "\r\n", Encoding.UTF8); } catch { }
        }

        public ChatForm(ChatTrayApp app)
        {
            this.app = app;
            Text = "KidsControlPC — Чат";
            try { Icon = ChatTrayApp.LoadAppIcon(); } catch { }
            Size = new Size(700, 540);
            MinimumSize = new Size(480, 380);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(15, 17, 26);
            ShowInTaskbar = true;
            FormClosing += delegate(object s, FormClosingEventArgs e) { e.Cancel = true; Hide(); };

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            Controls.Add(webView);

            // WebView2 needs a writable user-data folder; Program Files is read-only
            // for standard users. CreationProperties sets the folder before init.
            // Use ProgramData (not LocalAppData) — ChatTrayApp may launch as SYSTEM
            // during auto-update (service context), and SYSTEM's LocalAppData resolves
            // to C:\Windows\system32\config\systemprofile which is not writable.
            // ProgramData is always writable by SYSTEM and standard users alike.
            string wv2DataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "KidsControlPC", "WebView2Cache");
            try { if (!Directory.Exists(wv2DataDir)) Directory.CreateDirectory(wv2DataDir); } catch { }
            webView.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = wv2DataDir };

            webView.CoreWebView2InitializationCompleted += OnWebViewReady;
            var unused = webView.EnsureCoreWebView2Async(null);
        }

        private void OnWebViewReady(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess) return;
            webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.WebMessageReceived += OnWebMessage;
            webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
            // Wait for page to finish loading before calling ExecuteScriptAsync,
            // otherwise updateData() is not yet defined and the call silently fails.
            webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            webView.CoreWebView2.NavigateToString(GetHtml());
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            try
            {
                var dir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Downloads", "KidsControl");
                System.IO.Directory.CreateDirectory(dir);
                var origName = System.IO.Path.GetFileName(e.DownloadOperation.ResultFilePath);
                var dest = System.IO.Path.Combine(dir, origName);
                e.ResultFilePath = dest;
                e.Handled = true;
                e.DownloadOperation.StateChanged += (s, _) =>
                {
                    var op = (CoreWebView2DownloadOperation)s;
                    if (op.State == CoreWebView2DownloadState.Completed)
                    {
                        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dest) { UseShellExecute = true }); }
                        catch (Exception ex) { Log("OnDownloadStarting open error: " + ex.Message); }
                    }
                };
                Log("OnDownloadStarting → " + dest);
            }
            catch (Exception ex)
            {
                Log("OnDownloadStarting error: " + ex.Message);
            }
        }

        // Build a safe, non-colliding destination path inside Downloads\KidsControl.
        // Exposed for unit testing via reflection-free static call.
        public static string BuildDownloadPath(string dir, string name, Func<string, bool> exists)
        {
            foreach (var c in System.IO.Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            if (string.IsNullOrWhiteSpace(name)) name = "file";

            var dest = System.IO.Path.Combine(dir, name);
            if (!exists(dest)) return dest;

            var baseName = System.IO.Path.GetFileNameWithoutExtension(name);
            var ext = System.IO.Path.GetExtension(name);
            int i = 1;
            do { dest = System.IO.Path.Combine(dir, baseName + " (" + i++ + ")" + ext); }
            while (exists(dest));
            return dest;
        }

        private static void DownloadAndOpen(string url, string name)
        {
            try
            {
                var dir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Downloads", "KidsControl");
                System.IO.Directory.CreateDirectory(dir);

                var dest = BuildDownloadPath(dir, name, System.IO.File.Exists);

                // TLS 1.2 — Firebase rejects older protocols. The Uri %2F preservation
                // is handled by ChatTrayApp.exe.config (DontUnescapePathDotsAndSlashes).
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using (var wc = new WebClient())
                    wc.DownloadFile(url, dest);

                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dest) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show(
                    "Не удалось открыть файл:\n" + ex.Message,
                    "KidsControl",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Warning);
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Log("NavigationCompleted pending=" + (pendingChats != null ? pendingChats.Count.ToString() : "null"));
            webViewReady = true;
            if (pendingChats != null)
                PushData(pendingChats, pendingMessages);
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.TryGetWebMessageAsString();
                Log("OnWebMessage: " + (json ?? "null"));
                var ser = new JavaScriptSerializer();
                var msg = ser.Deserialize<Dictionary<string, object>>(json);
                if (msg == null) return;
                string type = msg.ContainsKey("type") ? msg["type"].ToString() : "";
                if (type == "log")
                {
                    string logMsg = msg.ContainsKey("msg") ? msg["msg"].ToString() : "";
                    Log("JS: " + logMsg);
                }
                else if (type == "selectChat")
                {
                    string chatId = msg.ContainsKey("chatId") ? msg["chatId"].ToString() : null;
                    if (chatId != null) { app.SetActiveChat(chatId); app.SendReadReceipt(chatId); }
                }
                else if (type == "markRead")
                {
                    string chatId = msg.ContainsKey("chatId") ? msg["chatId"].ToString() : null;
                    if (chatId != null) app.SendReadReceipt(chatId);
                }
                else if (type == "send")
                {
                    string chatId = msg.ContainsKey("chatId") ? msg["chatId"].ToString() : null;
                    string text = msg.ContainsKey("text") ? msg["text"].ToString() : null;
                    if (chatId != null && !string.IsNullOrEmpty(text)) app.SendReply(chatId, text);
                }
                else if (type == "sendGif")
                {
                    string chatId = msg.ContainsKey("chatId") ? msg["chatId"].ToString() : null;
                    string gifUrl = msg.ContainsKey("gifUrl") ? msg["gifUrl"].ToString() : null;
                    string gifPreviewUrl = msg.ContainsKey("gifPreviewUrl") ? msg["gifPreviewUrl"].ToString() : null;
                    if (chatId != null && !string.IsNullOrEmpty(gifUrl)) app.SendGifReply(chatId, gifUrl, gifPreviewUrl);
                }
                else if (type == "downloadFile")
                {
                    string url  = msg.ContainsKey("url")  ? msg["url"].ToString()  : null;
                    string name = msg.ContainsKey("name") ? msg["name"].ToString() : "file";
                    if (!string.IsNullOrEmpty(url)) Task.Run(() => DownloadAndOpen(url, name));
                }
                else if (type == "sendFile")
                {
                    string chatId = msg.ContainsKey("chatId") ? msg["chatId"].ToString() : null;
                    string fileName = msg.ContainsKey("fileName") ? msg["fileName"].ToString() : "file";
                    string mimeType = msg.ContainsKey("mimeType") ? msg["mimeType"].ToString() : "application/octet-stream";
                    long fileSize = msg.ContainsKey("fileSize") ? Convert.ToInt64(msg["fileSize"]) : 0;
                    string dataUrl = msg.ContainsKey("data") ? msg["data"].ToString() : null;
                    if (chatId != null && dataUrl != null)
                    {
                        try
                        {
                            int comma = dataUrl.IndexOf(',');
                            string b64 = comma >= 0 ? dataUrl.Substring(comma + 1) : dataUrl;
                            byte[] bytes = Convert.FromBase64String(b64);
                            string pendingDir = Path.Combine(
                                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                                "KidsControlPC", "pending_uploads");
                            Directory.CreateDirectory(pendingDir);
                            string safeFile = System.Text.RegularExpressions.Regex.Replace(fileName, @"[^\w\.\-]", "_");
                            string savePath = Path.Combine(pendingDir, Guid.NewGuid().ToString("N") + "_" + safeFile);
                            File.WriteAllBytes(savePath, bytes);
                            app.SendFileReply(chatId, savePath, fileName, fileSize > 0 ? fileSize : bytes.Length, mimeType);
                        }
                        catch (Exception ex) { Log("sendFile error: " + ex.Message); }
                    }
                }
            }
            catch { }
        }

        public void RefreshData(List<ChatData> newChats, Dictionary<string, List<ChatMsg>> newMsgs)
        {
            if (InvokeRequired) { BeginInvoke(new Action(delegate { RefreshData(newChats, newMsgs); })); return; }
            if (webViewReady)
                PushData(newChats, newMsgs);
            else
            {
                pendingChats = newChats;
                pendingMessages = newMsgs;
            }
        }

        private void PushData(List<ChatData> chatList, Dictionary<string, List<ChatMsg>> msgs)
        {
            if (chatList == null) return;
            var ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;

            var chatsArr = new List<Dictionary<string, object>>();
            foreach (var c in chatList)
            {
                var d = new Dictionary<string, object>();
                d["id"] = c.Id ?? "";
                d["name"] = c.Name ?? "";
                d["lastText"] = c.LastText ?? "";
                chatsArr.Add(d);
            }

            var msgsObj = new Dictionary<string, object>();
            if (msgs != null)
            {
                foreach (var kv in msgs)
                {
                    var list = new List<Dictionary<string, object>>();
                    foreach (var m in kv.Value)
                    {
                        var d = new Dictionary<string, object>();
                        d["id"] = m.Id ?? "";
                        d["text"] = m.Text ?? "";
                        d["gifUrl"] = m.GifUrl ?? "";
                        d["gifPreviewUrl"] = m.GifPreviewUrl ?? "";
                        d["fileUrl"] = m.FileUrl ?? "";
                        d["fileName"] = m.FileName ?? "";
                        d["fileSize"] = m.FileSize;
                        d["mimeType"] = m.MimeType ?? "";
                        d["fileDeleted"] = m.FileDeleted;
                        d["senderName"] = m.SenderName ?? "";
                        d["senderType"] = m.SenderType ?? "parent";
                        d["status"] = m.Status ?? "sent";
                        d["timestamp"] = m.Timestamp != DateTime.MinValue ? (object)m.Timestamp.ToString("o") : null;
                        list.Add(d);
                    }
                    msgsObj[kv.Key] = list;
                }
            }

            var payload = new Dictionary<string, object>();
            payload["chats"] = chatsArr;
            payload["messages"] = msgsObj;

            string json = ser.Serialize(payload);
            var unused = webView.CoreWebView2.ExecuteScriptAsync("updateData(" + json + ")");
        }

        private static string GetHtml()
        {
            return @"<!DOCTYPE html>
<html>
<head>
<meta charset='UTF-8'>
<meta name='color-scheme' content='dark'>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  background: #0f111a;
  color: #dde6f5;
  display: flex;
  height: 100vh;
  overflow: hidden;
  font-size: 14px;
  user-select: none;
}
#sidebar {
  width: 200px;
  min-width: 200px;
  background: #141724;
  border-right: 1px solid #1e2336;
  display: flex;
  flex-direction: column;
}
#sidebar-title {
  padding: 14px 14px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #5a6880;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  flex-shrink: 0;
}
#chat-list { flex: 1; overflow-y: auto; padding: 0 6px 6px; }
#chat-list::-webkit-scrollbar { width: 4px; }
#chat-list::-webkit-scrollbar-thumb { background: #252a40; border-radius: 2px; }
.chat-item {
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  transition: background 0.1s;
}
.chat-item:hover { background: #1c2035; }
.chat-item.active { background: #222d52; }
.chat-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  color: white;
  font-weight: 700;
}
.chat-info { overflow: hidden; flex: 1; min-width: 0; }
.chat-name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e2eaf8; }
.chat-preview { font-size: 11px; color: #4e5d78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
#main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
#header {
  padding: 0 16px;
  height: 50px;
  border-bottom: 1px solid #1a1e2e;
  display: flex;
  align-items: center;
  background: #0d0f1c;
  flex-shrink: 0;
}
#header-name { font-weight: 700; font-size: 15px; }
#messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
#messages::-webkit-scrollbar { width: 5px; }
#messages::-webkit-scrollbar-track { background: transparent; }
#messages::-webkit-scrollbar-thumb { background: #20263a; border-radius: 3px; }
.date-div {
  text-align: center;
  font-size: 11px;
  color: #3e4a60;
  margin: 10px 0 6px;
}
.msg-row { display: flex; flex-direction: column; margin-bottom: 2px; }
.msg-row.out { align-items: flex-end; }
.msg-row.in { align-items: flex-start; }
.sender { font-size: 11px; color: #6878b0; font-weight: 600; margin-bottom: 3px; margin-left: 2px; }
.bubble {
  max-width: 66%;
  padding: 8px 12px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}
.in .bubble { background: #1b1f35; border-bottom-left-radius: 5px; color: #d8e2f5; }
.out .bubble { background: #5254cc; border-bottom-right-radius: 5px; color: #fff; }
.bubble img { max-width: 220px; max-height: 200px; border-radius: 10px; display: block; }
.msg-time { font-size: 10px; color: #363f58; margin-top: 3px; padding: 0 2px; display: flex; align-items: center; gap: 3px; }
.out .msg-time { justify-content: flex-end; }
.ticks { display: inline-flex; align-items: center; color: #8892b0; }
.ticks.read { color: #4fc3f7; }
.empty-msg {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: #363f58; font-size: 14px; text-align: center;
}
#input-area {
  padding: 10px 14px 12px;
  background: #111320;
  border-top: 1px solid #1a1e2e;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
#input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
#file-pending {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #1b1f35;
  border: 1px solid #6366f1;
  border-radius: 10px;
  font-size: 12px;
  color: #b0bcd6;
}
#file-pending.show { display: flex; }
#file-pending-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#file-pending-remove { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px; padding: 0 2px; flex-shrink: 0; }
#input-box {
  flex: 1;
  background: #181c2e;
  border: 1px solid #242840;
  border-radius: 20px;
  padding: 9px 16px;
  color: #dde6f5;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  resize: none;
  min-height: 38px;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.4;
  user-select: text;
  transition: border-color 0.15s;
}
#input-box:focus { border-color: #4648a8; }
#input-box::placeholder { color: #333d58; }
#attach-btn {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: #1b1f35;
  border: 1px solid #242840;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
  transition: background 0.15s;
  color: #8892b0;
}
#attach-btn:hover { background: #222d52; color: #dde6f5; }
#send-btn {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: #6366f1;
  border: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, transform 0.1s;
}
#send-btn:hover { background: #5254cc; }
#send-btn:active { transform: scale(0.93); }
#send-btn svg { width: 18px; height: 18px; fill: white; margin-left: 2px; }
.file-img { max-width: 220px; max-height: 200px; border-radius: 10px; display: block; cursor: pointer; }
.file-doc {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; cursor: pointer;
  background: rgba(255,255,255,0.07);
  border-radius: 10px;
  text-decoration: none; color: #dde6f5;
}
.file-doc:hover { background: rgba(255,255,255,0.13); }
.file-doc-icon { font-size: 18px; }
.file-doc-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.file-doc-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-doc-size { font-size: 10px; opacity: 0.55; }
.file-doc-dl { font-size: 14px; opacity: 0.5; margin-left: auto; flex-shrink: 0; }
.file-deleted { opacity: 0.5; font-size: 12px; font-style: italic; padding: 4px 0; }
#file-input { display: none; }
.icon-btn {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: #1b1f35;
  border: 1px solid #242840;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
  transition: background 0.15s;
  color: #8892b0;
}
.icon-btn:hover { background: #222d52; color: #dde6f5; }
.icon-btn.active { background: #222d52; color: #fff; }
#emoji-panel {
  display: none;
  flex-wrap: wrap;
  gap: 2px;
  max-height: 168px;
  overflow-y: auto;
  padding: 8px;
  background: #141724;
  border: 1px solid #242840;
  border-radius: 12px;
  margin-bottom: 2px;
}
#emoji-panel.show { display: flex; }
#emoji-panel::-webkit-scrollbar { width: 5px; }
#emoji-panel::-webkit-scrollbar-thumb { background: #252a40; border-radius: 3px; }
.emoji-cell {
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  cursor: pointer;
  border-radius: 8px;
  background: none; border: none;
  transition: background 0.1s;
}
.emoji-cell:hover { background: #222d52; }
#gif-panel {
  display: none;
  flex-direction: column;
  gap: 8px;
  background: #141724;
  border: 1px solid #242840;
  border-radius: 12px;
  padding: 8px;
  margin-bottom: 2px;
}
#gif-panel.show { display: flex; }
#gif-search {
  background: #181c2e;
  border: 1px solid #242840;
  border-radius: 10px;
  padding: 8px 12px;
  color: #dde6f5;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
#gif-search:focus { border-color: #4648a8; }
#gif-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 90px;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  align-content: start;
}
#gif-grid::-webkit-scrollbar { width: 5px; }
#gif-grid::-webkit-scrollbar-thumb { background: #252a40; border-radius: 3px; }
.gif-cell {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  cursor: pointer;
  background: #181c2e;
  border: none;
  overflow: hidden;
  padding: 0;
}
.gif-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gif-cell:hover { outline: 2px solid #6366f1; }
#gif-status { font-size: 12px; color: #4e5d78; text-align: center; padding: 8px; }
</style>
</head>
<body>
<div id='sidebar'>
  <div id='sidebar-title'>Чаты</div>
  <div id='chat-list'></div>
</div>
<div id='main'>
  <div id='header'><span id='header-name'>Выберите чат</span></div>
  <div id='messages'><div class='empty-msg'>Выберите чат слева</div></div>
  <div id='input-area'>
    <div id='file-pending'>
      <span>📎</span>
      <span id='file-pending-name'></span>
      <button id='file-pending-remove' onclick='removePendingFile()'>×</button>
    </div>
    <div id='emoji-panel'></div>
    <div id='gif-panel'>
      <input type='text' id='gif-search' placeholder='Поиск GIF...'>
      <div id='gif-grid'></div>
      <div id='gif-status'></div>
    </div>
    <div id='input-row'>
      <input type='file' id='file-input' accept='image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv'>
      <button id='emoji-btn' class='icon-btn' onclick='toggleEmoji()' title='Эмодзи'>😊</button>
      <button id='gif-btn' class='icon-btn' onclick='toggleGif()' title='GIF' style='font-size:12px;font-weight:700;'>GIF</button>
      <button id='attach-btn' class='icon-btn' onclick='openFileDialog()' title='Прикрепить файл'>📎</button>
      <textarea id='input-box' placeholder='Написать сообщение...' rows='1'></textarea>
      <button id='send-btn'>
        <svg viewBox='0 0 24 24'><path d='M2.01 21L23 12 2.01 3 2 10l15 2-15 2z'/></svg>
      </button>
    </div>
  </div>
</div>
<script>
var currentChatId = null;
var allData = {chats:[], messages:{}};

function updateData(data) {
  allData = data;
  renderChatList();
  // Auto-select if only one chat and none selected yet
  if (!currentChatId && allData.chats && allData.chats.length === 1) {
    selectChat(allData.chats[0].id, allData.chats[0].name);
    return;
  }
  if (currentChatId) {
    renderMessages(currentChatId);
    // New messages may have arrived while this chat is open — mark them read.
    window.chrome.webview.postMessage(JSON.stringify({type:'markRead',chatId:currentChatId}));
  }
}

function renderChatList() {
  var list = document.getElementById('chat-list');
  list.innerHTML = '';
  (allData.chats || []).forEach(function(chat) {
    var div = document.createElement('div');
    div.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
    var first = (chat.name || '?').charAt(0).toUpperCase();
    div.innerHTML =
      '<div class=\'chat-avatar\'>' + first + '</div>' +
      '<div class=\'chat-info\'>' +
        '<div class=\'chat-name\'>' + esc(chat.name) + '</div>' +
        '<div class=\'chat-preview\'>' + esc(chat.lastText || '') + '</div>' +
      '</div>';
    (function(cid, cname) {
      div.onclick = function() { selectChat(cid, cname); };
    })(chat.id, chat.name);
    list.appendChild(div);
  });
}

function selectChat(chatId, chatName) {
  currentChatId = chatId;
  document.getElementById('header-name').textContent = chatName || '';
  renderChatList();
  renderMessages(chatId);
  window.chrome.webview.postMessage(JSON.stringify({type:'selectChat',chatId:chatId}));
}

function renderMessages(chatId) {
  var msgs = (allData.messages || {})[chatId] || [];
  var container = document.getElementById('messages');
  container.innerHTML = '';
  if (msgs.length === 0) {
    container.innerHTML = '<div class=\'empty-msg\'>Нет сообщений. Напишите первым! 💬</div>';
    return;
  }
  var lastDate = null;
  msgs.forEach(function(m) {
    var ts = m.timestamp ? new Date(m.timestamp) : null;
    if (ts) {
      var dateStr = ts.toLocaleDateString('ru-RU', {day:'numeric',month:'long'});
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        var dd = document.createElement('div');
        dd.className = 'date-div';
        dd.textContent = dateStr;
        container.appendChild(dd);
      }
    }
    var isChild = m.senderType === 'child';
    var row = document.createElement('div');
    row.className = 'msg-row ' + (isChild ? 'out' : 'in');
    var html = '';
    if (!isChild) {
      html += '<div class=\'sender\'>' + esc(m.senderName || 'Родитель') + '</div>';
    }
    var isGif = !m.text && (m.gifUrl || m.gifPreviewUrl);
    var bubbleContent = '';
    if (m.text) bubbleContent += esc(m.text);
    if (isGif) bubbleContent += '<img src=\'' + escA(m.gifPreviewUrl || m.gifUrl) + '\' alt=\'GIF\'>';
    if (m.fileUrl && m.fileDeleted) {
      bubbleContent += '<div class=\'file-deleted\'>🗑 ' + esc(m.fileName || 'Файл') + ' <em>— файл удалён</em></div>';
    } else if (m.fileUrl && m.mimeType && m.mimeType.indexOf('image/') === 0) {
      bubbleContent += '<img src=\'' + escA(m.fileUrl) + '\' alt=\'' + esc(m.fileName || 'изображение') + '\' class=\'file-img\' style=\'cursor:pointer\' onclick=\'downloadFile(' + JSON.stringify(m.fileUrl) + ',' + JSON.stringify(m.fileName || 'image') + ')\'>';
    } else if (m.fileUrl) {
      var sizeStr = m.fileSize ? (m.fileSize < 1024*1024 ? (m.fileSize/1024).toFixed(1)+' КБ' : (m.fileSize/1024/1024).toFixed(1)+' МБ') : '';
      bubbleContent += '<div class=\'file-doc\' onclick=\'downloadFile(' + JSON.stringify(m.fileUrl) + ',' + JSON.stringify(m.fileName || 'Файл') + ')\'>' +
        '<span class=\'file-doc-icon\'>📎</span>' +
        '<span class=\'file-doc-info\'><span class=\'file-doc-name\'>' + esc(m.fileName || 'Файл') + '</span>' +
        (sizeStr ? '<span class=\'file-doc-size\'>' + sizeStr + '</span>' : '') + '</span>' +
        '<span class=\'file-doc-dl\'>⬇</span></div>';
    }
    html += '<div class=\'bubble\'>' + bubbleContent + '</div>';
    var timeInner = '';
    if (ts) timeInner += ts.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
    if (isChild) timeInner += statusTicks(m.status);
    if (timeInner) html += '<div class=\'msg-time\'>' + timeInner + '</div>';
    row.innerHTML = html;
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

function downloadFile(url, name) {
  window.chrome.webview.postMessage(JSON.stringify({type:'downloadFile', url:url, name:name}));
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escA(s) {
  return String(s).replace(/'/g,'%27').replace(/""/g,'%22');
}

// WhatsApp-style ticks for the child's own outgoing messages.
function statusTicks(status) {
  var cls = status === 'read' ? 'ticks read' : 'ticks';
  var d2 = (status === 'read' || status === 'delivered');
  var w = d2 ? 16 : 11;
  var vb = d2 ? '0 0 16 11' : '0 0 11 11';
  var p2 = d2 ? '<path d=\'M6.5 8.2L7 8.5L12.5 2.5\' stroke=\'currentColor\' stroke-width=\'1.4\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/>' : '';
  return '<span class=\'' + cls + '\'><svg width=\'' + w + '\' height=\'11\' viewBox=\'' + vb + '\' fill=\'none\'>' +
    '<path d=\'M1 5.5L4 8.5L9.5 2.5\' stroke=\'currentColor\' stroke-width=\'1.4\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/>' + p2 + '</svg></span>';
}

var pendingFileData = null; // {name, size, mimeType, dataUrl}

// ── Emoji ──
var EMOJI = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','😜','🤪','😋','🤗','🤔','😐','😴','😇','🙂','😉','😆','🥹','😭','😢','😡','😱','😳','🥰','😏','🤫','🤭','😬','🙄','😤','😈','👻','💀','🤖','🎃','😺','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🦄','🐝','🦋','🌟','⭐','✨','🔥','💥','🎉','🎊','🎈','🎁','❤️','🧡','💛','💚','💙','💜','🖤','💯','👍','👎','👏','🙌','🙏','💪','✌️','🤞','👌','🤙','👋','🤝','💋','👀','🍕','🍔','🍟','🌭','🍩','🍪','🍰','🎂','🍦','🍫','🍬','🍭','🍎','🍌','🍉','🍓','⚽','🏀','🎮','🕹️','🎯','🎸','🎵','🚗','✈️','🚀','🌈','☀️','🌙','⚡','❄️','💧'];

function buildEmojiPanel() {
  var panel = document.getElementById('emoji-panel');
  if (panel.childElementCount > 0) return;
  EMOJI.forEach(function(em) {
    var b = document.createElement('button');
    b.className = 'emoji-cell';
    b.textContent = em;
    b.onclick = function() { insertEmoji(em); };
    panel.appendChild(b);
  });
}

function insertEmoji(em) {
  var box = document.getElementById('input-box');
  var start = box.selectionStart || box.value.length;
  var end = box.selectionEnd || box.value.length;
  box.value = box.value.slice(0, start) + em + box.value.slice(end);
  box.focus();
  box.selectionStart = box.selectionEnd = start + em.length;
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 120) + 'px';
}

function toggleEmoji() {
  var panel = document.getElementById('emoji-panel');
  var gifPanel = document.getElementById('gif-panel');
  gifPanel.classList.remove('show');
  document.getElementById('gif-btn').classList.remove('active');
  buildEmojiPanel();
  var show = !panel.classList.contains('show');
  panel.classList.toggle('show', show);
  document.getElementById('emoji-btn').classList.toggle('active', show);
}

// ── GIF ──
var GIPHY_KEY = 'sgrC3ibUohfTjbUb8Ue9IxkLC3FfQkdI';
var gifDebounce = null;

function toggleGif() {
  var panel = document.getElementById('gif-panel');
  var emojiPanel = document.getElementById('emoji-panel');
  emojiPanel.classList.remove('show');
  document.getElementById('emoji-btn').classList.remove('active');
  var show = !panel.classList.contains('show');
  panel.classList.toggle('show', show);
  document.getElementById('gif-btn').classList.toggle('active', show);
  if (show) {
    document.getElementById('gif-search').focus();
    fetchGifs('');
  }
}

function fetchGifs(q) {
  var status = document.getElementById('gif-status');
  var grid = document.getElementById('gif-grid');
  status.textContent = 'Загрузка...';
  var url = q
    ? 'https://api.giphy.com/v1/gifs/search?api_key=' + GIPHY_KEY + '&q=' + encodeURIComponent(q) + '&lang=ru&limit=18&rating=g'
    : 'https://api.giphy.com/v1/gifs/trending?api_key=' + GIPHY_KEY + '&limit=18&rating=g';
  fetch(url).then(function(r){ return r.json(); }).then(function(json) {
    var data = json.data || [];
    grid.innerHTML = '';
    if (data.length === 0) { status.textContent = 'Ничего не найдено'; return; }
    status.textContent = '';
    data.forEach(function(g) {
      var orig = g.images.original.url;
      var prev = g.images.fixed_height_small.url;
      var btn = document.createElement('button');
      btn.className = 'gif-cell';
      var img = document.createElement('img');
      img.src = prev; img.loading = 'lazy';
      btn.appendChild(img);
      btn.onclick = function() { selectGif(orig, prev); };
      grid.appendChild(btn);
    });
  }).catch(function() { status.textContent = 'Ошибка загрузки GIF'; });
}

function selectGif(gifUrl, gifPreviewUrl) {
  if (!currentChatId) return;
  document.getElementById('gif-panel').classList.remove('show');
  document.getElementById('gif-btn').classList.remove('active');
  appendOptimisticGif(gifPreviewUrl || gifUrl);
  window.chrome.webview.postMessage(JSON.stringify({
    type: 'sendGif', chatId: currentChatId, gifUrl: gifUrl, gifPreviewUrl: gifPreviewUrl
  }));
}

document.getElementById('gif-search').addEventListener('input', function() {
  var q = this.value.trim();
  clearTimeout(gifDebounce);
  var self = this;
  gifDebounce = setTimeout(function() { fetchGifs(q); }, 400);
});

document.getElementById('send-btn').onclick = sendMsg;
document.getElementById('input-box').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
document.getElementById('input-box').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});
document.getElementById('file-input').addEventListener('change', function(e) {
  var file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.type.indexOf('video/') === 0) { alert('Видео не поддерживается'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('Файл больше 10 МБ'); return; }
  var reader = new FileReader();
  reader.onload = function(ev) {
    pendingFileData = { name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', dataUrl: ev.target.result };
    var pending = document.getElementById('file-pending');
    pending.classList.add('show');
    document.getElementById('file-pending-name').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

function openFileDialog() {
  document.getElementById('file-input').click();
}

function removePendingFile() {
  pendingFileData = null;
  document.getElementById('file-pending').classList.remove('show');
  document.getElementById('file-pending-name').textContent = '';
}

function sendMsg() {
  if (!currentChatId) {
    window.chrome.webview.postMessage(JSON.stringify({type:'log',msg:'sendMsg: no chat selected'}));
    return;
  }
  if (pendingFileData) {
    var fd = pendingFileData;
    pendingFileData = null;
    document.getElementById('file-pending').classList.remove('show');
    document.getElementById('file-pending-name').textContent = '';
    window.chrome.webview.postMessage(JSON.stringify({
      type: 'sendFile',
      chatId: currentChatId,
      fileName: fd.name,
      fileSize: fd.size,
      mimeType: fd.mimeType,
      data: fd.dataUrl
    }));
    return;
  }
  var box = document.getElementById('input-box');
  var text = box.value.trim();
  if (!text) return;
  box.value = '';
  box.style.height = 'auto';
  document.getElementById('emoji-panel').classList.remove('show');
  document.getElementById('emoji-btn').classList.remove('active');
  appendOptimistic(text);
  window.chrome.webview.postMessage(JSON.stringify({type:'send',chatId:currentChatId,text:text}));
}

function appendOptimistic(text) {
  var container = document.getElementById('messages');
  var empty = container.querySelector('.empty-msg');
  if (empty) empty.remove();
  var row = document.createElement('div');
  row.className = 'msg-row out';
  row.setAttribute('data-optimistic', '1');
  row.innerHTML = '<div class=\'bubble\' style=\'opacity:0.7\'>' + esc(text) + '</div>';
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function appendOptimisticGif(previewUrl) {
  var container = document.getElementById('messages');
  var empty = container.querySelector('.empty-msg');
  if (empty) empty.remove();
  var row = document.createElement('div');
  row.className = 'msg-row out';
  row.setAttribute('data-optimistic', '1');
  row.innerHTML = '<div class=\'bubble\' style=\'opacity:0.7\'><img src=\'' + escA(previewUrl) + '\' alt=\'GIF\'></div>';
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}
</script>
</body>
</html>";
        }
    }
}
