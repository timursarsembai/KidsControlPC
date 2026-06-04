using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace KidsControl
{
    internal static class SessionLauncher
    {
        private const int CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const int TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const int TOKEN_DUPLICATE = 0x0002;
        private const int TOKEN_IMPERSONATE = 0x0004;
        private const int TOKEN_QUERY = 0x0008;
        private const int TOKEN_ADJUST_DEFAULT = 0x0080;
        private const int TOKEN_ADJUST_SESSIONID = 0x0100;
        private const int SecurityImpersonation = 2;
        private const int TokenPrimary = 1;
        private static readonly IntPtr WTS_CURRENT_SERVER_HANDLE = IntPtr.Zero;

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll")]
        private static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("wtsapi32.dll", SetLastError = true)]
        private static extern bool WTSQueryUserToken(uint SessionId, out IntPtr phToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DuplicateTokenEx(
            IntPtr hExistingToken,
            int dwDesiredAccess,
            IntPtr lpTokenAttributes,
            int ImpersonationLevel,
            int TokenType,
            out IntPtr phNewToken);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessAsUser(
            IntPtr hToken,
            string lpApplicationName,
            string lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            int dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("Usage: SessionLauncher.exe <exePath> [args...]");
                return 2;
            }

            string exePath = args[0];
            string arguments = BuildArguments(args);
            string commandLine = "\"" + exePath + "\"" + (arguments.Length > 0 ? " " + arguments : "");
            string workingDirectory = System.IO.Path.GetDirectoryName(exePath);

            IntPtr userToken = IntPtr.Zero;
            IntPtr primaryToken = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;
            PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();

            try
            {
                uint sessionId = WTSGetActiveConsoleSessionId();
                if (sessionId == 0xFFFFFFFF)
                {
                    throw new InvalidOperationException("No active console session");
                }

                if (!WTSQueryUserToken(sessionId, out userToken))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken failed");
                }

                int desiredAccess = TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_IMPERSONATE |
                    TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID;

                if (!DuplicateTokenEx(userToken, desiredAccess, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primaryToken))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateTokenEx failed");
                }

                if (!CreateEnvironmentBlock(out environment, primaryToken, false))
                {
                    environment = IntPtr.Zero;
                }

                STARTUPINFO startupInfo = new STARTUPINFO();
                startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                startupInfo.lpDesktop = "winsta0\\default";

                bool ok = CreateProcessAsUser(
                    primaryToken,
                    null,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    CREATE_UNICODE_ENVIRONMENT,
                    environment,
                    workingDirectory,
                    ref startupInfo,
                    out processInfo);

                if (!ok)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser failed");
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
            finally
            {
                if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
                if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
                if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
                if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
                if (userToken != IntPtr.Zero) CloseHandle(userToken);
            }
        }

        private static string BuildArguments(string[] args)
        {
            if (args.Length <= 1) return "";

            StringBuilder builder = new StringBuilder();
            for (int i = 1; i < args.Length; i++)
            {
                if (builder.Length > 0) builder.Append(' ');
                builder.Append('"');
                builder.Append(args[i].Replace("\"", "\\\""));
                builder.Append('"');
            }
            return builder.ToString();
        }
    }
}
