// LoL Coach — lanzador de Windows.
// Arranca el servidor de Node sin ventana de consola, abre la app en su propia ventana
// (Chrome/Edge en modo aplicación) y se queda en la bandeja del sistema.
// Se compila con scripts/build-exe.ps1.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

static partial class Program
{
    static string root;
    static int port = 3737;
    static Process server;
    static NotifyIcon tray;
    static bool exiting;
    static StreamWriter log;
    static OverlayForm overlay;

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main(string[] args)
    {
        root = AppDomain.CurrentDomain.BaseDirectory;
        port = ReadPort();
        // LoL Coach.exe --overlay-test salida.png [puerto] : genera una imagen del overlay para comprobar el diseño
        if (args.Length >= 2 && args[0] == "--overlay-test")
        {
            OverlayForm.RenderTest(args.Length >= 3 ? int.Parse(args[2]) : port, args[1], 1920, 1080);
            return;
        }
        // LoL Coach.exe --update-check-test salida.txt : dice qué haría el actualizador (sin descargar nada)
        if (args.Length >= 2 && args[0] == "--update-check-test")
        {
            UpdateCheckTest(args[1]);
            return;
        }
        bool afterUpdate = Array.IndexOf(args, "--after-update") >= 0;
        try { SetProcessDPIAware(); } catch { }

        bool first;
        // LOLCOACH_INSTANCE: solo para pruebas (permite abrir una instalación de prueba junto a la app normal)
        var mutex = new Mutex(true, "LoLCoach.SingleInstance" + Env("LOLCOACH_INSTANCE"), out first);
        if (!first && afterUpdate)
        {
            // Relanzado tras actualizar: esperamos a que se cierre la versión anterior
            try { first = mutex.WaitOne(30000); } catch (AbandonedMutexException) { first = true; }
        }
        if (!first)
        {
            // Ya está abierto: solo mostramos la ventana
            OpenWindow();
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Directory.CreateDirectory(Path.Combine(root, "data"));
        try { log = new StreamWriter(Path.Combine(root, "data", "lolcoach.log"), afterUpdate, new System.Text.UTF8Encoding(false)) { AutoFlush = true }; } catch { }
        ui = new Control();
        ui.CreateControl();
        var uiHandle = ui.Handle; // para mostrar diálogos desde otros hilos

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "LoL Coach",
            Visible = true,
        };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir LoL Coach", null, (s, e) => OpenWindow());
        menu.Items.Add("Reiniciar servidor", null, (s, e) => { StopServer(); StartServer(); WaitAndOpen(false); });
        menu.Items.Add("Mover / bloquear overlay", null, (s, e) => OverlayForm.PostSetting(port, "overlay.locked", OverlayForm.Editing ? "true" : "false"));
        menu.Items.Add("Ver registro", null, (s, e) => OpenLog());
        menu.Items.Add("Buscar actualizaciones", null, (s, e) => StartUpdateCheck(true));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, (s, e) => Exit());
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (s, e) => OpenWindow();

        if (!PortOpen()) StartServer();
        WaitAndOpen(true);
        StartOverlay(); // se muestra u oculta según los Ajustes de la app (Overlay en partida)
        CleanupAfterUpdate();
        if (afterUpdate)
        {
            string v, r;
            try { ReadPackage(root, out v, out r); } catch { v = "?"; }
            Log("Arrancada la versión " + v + " tras actualizar.");
            tray.ShowBalloonTip(5000, "LoL Coach", "LoL Coach se ha actualizado a la versión " + v + ".", ToolTipIcon.Info);
        }
        ScheduleUpdateCheck(); // solo hace algo en la versión empaquetada

        Application.Run();
        GC.KeepAlive(mutex);
    }

    // ---------- Overlay ----------
    static void StartOverlay()
    {
        if (overlay != null) return;
        overlay = new OverlayForm(port);
        overlay.CreateControl();
        var h = overlay.Handle; // crea la ventana sin mostrarla; se enseña sola cuando estás en partida
    }

    static void StopOverlay()
    {
        if (overlay == null) return;
        overlay.Stop();
        overlay.Close();
        overlay.Dispose();
        overlay = null;
    }

    static int ReadPort()
    {
        try
        {
            var env = Path.Combine(root, ".env");
            if (File.Exists(env))
            {
                var m = Regex.Match(File.ReadAllText(env), @"^\s*PORT\s*=\s*(\d+)", RegexOptions.Multiline);
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
        }
        catch { }
        return 3737;
    }

    static bool PortOpen()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var r = c.BeginConnect("127.0.0.1", port, null, null);
                return r.AsyncWaitHandle.WaitOne(300) && c.Connected;
            }
        }
        catch { return false; }
    }

    static string FindNode()
    {
        // Node portátil junto a la app (versión para compartir: no hace falta instalar nada)
        var portable = Path.Combine(root, "runtime", "node.exe");
        if (File.Exists(portable)) return portable;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try
            {
                var p = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                if (File.Exists(p)) return p;
            }
            catch { }
        }
        foreach (var p in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe") })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static void StartServer()
    {
        var node = FindNode();
        if (node == null)
        {
            MessageBox.Show("No encuentro Node.js. Instálalo desde https://nodejs.org y vuelve a abrir LoL Coach.", "LoL Coach", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Exit();
            return;
        }
        Directory.CreateDirectory(Path.Combine(root, "data"));
        // Se abre una vez al arrancar (abrirlo otra vez en «Reiniciar servidor» fallaba: el archivo ya estaba abierto)
        if (log == null) log = new StreamWriter(Path.Combine(root, "data", "lolcoach.log"), true, new System.Text.UTF8Encoding(false)) { AutoFlush = true };

        var psi = new ProcessStartInfo(node, "src/index.js")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
        };
        server = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var lg = log;
        server.OutputDataReceived += (s, e) => { if (e.Data != null) lock (lg) lg.WriteLine(e.Data); };
        server.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (lg) lg.WriteLine(e.Data); };
        server.Exited += (s, e) =>
        {
            if (exiting || updating) return;
            tray.ShowBalloonTip(5000, "LoL Coach", "El servidor se ha detenido. Usa «Reiniciar servidor» en el icono de la bandeja.", ToolTipIcon.Warning);
        };
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
    }

    static void StopServer()
    {
        try { if (server != null && !server.HasExited) { server.Kill(); server.WaitForExit(3000); } } catch { }
        server = null;
    }

    static void WaitAndOpen(bool firstTime)
    {
        new Thread(() =>
        {
            for (int i = 0; i < 100 && !exiting; i++)
            {
                if (PortOpen())
                {
                    OpenWindow();
                    if (firstTime) tray.ShowBalloonTip(4000, "LoL Coach", "Sigue funcionando aquí aunque cierres la ventana. Clic derecho para salir.", ToolTipIcon.Info);
                    return;
                }
                Thread.Sleep(300);
            }
            if (!exiting) MessageBox.Show("El servidor no ha arrancado. Revisa el registro (clic derecho en el icono de la bandeja > Ver registro).", "LoL Coach", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }) { IsBackground = true }.Start();
    }

    static string FindBrowser()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var p in new[] {
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe") })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static void OpenWindow()
    {
        if (Env("LOLCOACH_NO_WINDOW") == "1") return; // solo para pruebas automáticas
        var url = "http://localhost:" + port;
        var browser = FindBrowser();
        try
        {
            if (browser != null)
            {
                // Modo aplicación: ventana propia sin pestañas ni barra de direcciones, con su propio perfil
                var profile = Path.Combine(root, "data", "app-window");
                Process.Start(browser, "--app=" + url + " --window-size=1500,950 --no-first-run --no-default-browser-check --user-data-dir=\"" + profile + "\"");
            }
            else
            {
                Process.Start(url);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("No he podido abrir la ventana: " + ex.Message, "LoL Coach");
        }
    }

    static void OpenLog()
    {
        var f = Path.Combine(root, "data", "lolcoach.log");
        if (File.Exists(f)) Process.Start("notepad.exe", "\"" + f + "\"");
    }

    static void Exit()
    {
        exiting = true;
        StopOverlay();
        StopServer();
        if (tray != null) { tray.Visible = false; tray.Dispose(); }
        Application.Exit();
        Environment.Exit(0);
    }
}
