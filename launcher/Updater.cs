// LoL Coach — actualizaciones desde GitHub Releases.
//
// Solo actúa en la versión empaquetada (existe runtime\node.exe junto al exe); en la carpeta de
// desarrollo no hace nada. Lee "version" y "updateRepo" de package.json y consulta
// https://api.github.com/repos/{updateRepo}/releases/latest. Si hay una versión mayor, PREGUNTA
// (Sí / Ahora no / Saltar esta versión; la saltada se guarda en data\update.json).
// Al actualizar: descarga el zip (una carpeta raíz "LoL Coach/"), lo comprueba, para el servidor
// y el overlay, sustituye/añade los archivos sin tocar data\ (el exe en uso se renombra a
// "LoL Coach.old.exe"; lo sustituido se guarda en data\update-backup para poder deshacer),
// relanza el exe nuevo con --after-update y se cierra. El siguiente arranque limpia los restos.
//
// Variables de entorno SOLO PARA PRUEBAS (no las usa la app normal):
//   LOLCOACH_UPDATE_API=http://127.0.0.1:3805/latest   sustituye la URL de la API de GitHub
//   LOLCOACH_UPDATE_AUTOACCEPT=1   (solo junto a LOLCOACH_UPDATE_API) responde «Sí» sin mostrar el diálogo
//   LOLCOACH_UPDATE_DELAY=ms       espera antes de la comprobación automática (por defecto 8000)
// Modo de prueba sin interfaz: LoL Coach.exe --update-check-test salida.txt
//   (escribe lo que haría: versión instalada, remota y acción; no descarga ni cambia nada)

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static partial class Program
{
    static Control ui;            // para ejecutar cosas en el hilo de la interfaz
    static int updateBusy;        // 1 mientras se busca / descarga / instala
    static volatile bool updating; // el servidor se para a propósito: no avisar de que se ha detenido

    class ReleaseInfo { public string Version, ZipUrl, ZipName; }

    static string Env(string name) { return Environment.GetEnvironmentVariable(name) ?? ""; }

    static bool IsPackaged() { return File.Exists(Path.Combine(root, "runtime", "node.exe")); }

    static void Log(string msg)
    {
        var line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [actualizador] " + msg;
        try
        {
            if (log != null) { lock (log) log.WriteLine(line); }
            else
            {
                Directory.CreateDirectory(Path.Combine(root, "data"));
                File.AppendAllText(Path.Combine(root, "data", "lolcoach.log"), line + Environment.NewLine);
            }
        }
        catch { }
    }

    // ---------- Versiones y datos ----------
    static Dictionary<string, object> ReadJson(string path)
    {
        return new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
    }

    static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString().Trim() : "";
    }

    static void ReadPackage(string dir, out string version, out string repo)
    {
        version = ""; repo = "";
        var d = ReadJson(Path.Combine(dir, "package.json"));
        version = Str(d, "version");
        repo = Str(d, "updateRepo");
    }

    // "v1.2.3", "1.2", "1.2.3-beta" -> [1,2,3]; null si no es válida
    static int[] ParseVersion(string v)
    {
        if (string.IsNullOrEmpty(v)) return null;
        v = v.Trim();
        if (v.StartsWith("v") || v.StartsWith("V")) v = v.Substring(1);
        int cut = v.IndexOfAny(new[] { '-', '+' });
        if (cut >= 0) v = v.Substring(0, cut);
        var parts = v.Split('.');
        if (parts.Length < 1 || parts.Length > 3) return null;
        var r = new int[3];
        for (int i = 0; i < parts.Length; i++) if (!int.TryParse(parts[i], out r[i]) || r[i] < 0) return null;
        return r;
    }

    static string CleanVersion(string v)
    {
        var p = ParseVersion(v);
        return p == null ? v : p[0] + "." + p[1] + "." + p[2];
    }

    static int CompareVersions(int[] a, int[] b)
    {
        for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
        return 0;
    }

    static string SkippedVersion()
    {
        try
        {
            var f = Path.Combine(root, "data", "update.json");
            return File.Exists(f) ? Str(ReadJson(f), "skipped") : "";
        }
        catch { return ""; }
    }

    static void SaveSkippedVersion(string v)
    {
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "data"));
            var json = new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "skipped", v } });
            File.WriteAllText(Path.Combine(root, "data", "update.json"), json, new UTF8Encoding(false));
        }
        catch (Exception ex) { Log("No he podido guardar la versión saltada: " + ex.Message); }
    }

    // ---------- Red ----------
    static string ApiUrl(string repo)
    {
        var test = Env("LOLCOACH_UPDATE_API");
        if (test != "") return test;
        if (!Regex.IsMatch(repo ?? "", @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) return null;
        return "https://api.github.com/repos/" + repo + "/releases/latest";
    }

    static HttpWebRequest MakeRequest(string url, int timeout, string accept, string version)
    {
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { } // TLS 1.2
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.UserAgent = "LoLCoach-Updater/" + version;
        req.Accept = accept;
        req.Timeout = timeout;
        req.ReadWriteTimeout = timeout;
        req.AllowAutoRedirect = true;
        return req;
    }

    static ReleaseInfo FetchLatest(string url, string current)
    {
        string body;
        var req = MakeRequest(url, 8000, "application/vnd.github+json", current);
        using (var res = (HttpWebResponse)req.GetResponse())
        using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
            body = sr.ReadToEnd();
        var d = new JavaScriptSerializer().DeserializeObject(body) as Dictionary<string, object>;
        if (d == null) throw new Exception("respuesta de la API no válida");
        if (Str(d, "draft") == "True" || Str(d, "prerelease") == "True") throw new Exception("la última release es borrador o prerelease");
        var info = new ReleaseInfo { Version = CleanVersion(Str(d, "tag_name")) };
        object assets;
        if (d.TryGetValue("assets", out assets) && assets is IEnumerable)
        {
            foreach (var a in (IEnumerable)assets)
            {
                var ad = a as Dictionary<string, object>;
                var name = Str(ad, "name");
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    info.ZipName = name;
                    info.ZipUrl = Str(ad, "browser_download_url");
                    break;
                }
            }
        }
        return info;
    }

    // ---------- Comprobación ----------
    static void ScheduleUpdateCheck()
    {
        int delay;
        if (!int.TryParse(Env("LOLCOACH_UPDATE_DELAY"), out delay)) delay = 8000;
        new Thread(() =>
        {
            Thread.Sleep(delay); // que antes arranque todo lo demás
            if (!exiting) StartUpdateCheck(false);
        }) { IsBackground = true }.Start();
    }

    static void StartUpdateCheck(bool manual)
    {
        if (!IsPackaged())
        {
            Log("Carpeta de desarrollo (sin runtime\\node.exe): no se buscan actualizaciones.");
            if (manual) ShowMsg("Las actualizaciones solo funcionan en la versión empaquetada de LoL Coach (la que lleva la carpeta «runtime»).", MessageBoxIcon.Information);
            return;
        }
        if (Interlocked.CompareExchange(ref updateBusy, 1, 0) != 0)
        {
            if (manual) ShowMsg("Ya se está buscando o instalando una actualización.", MessageBoxIcon.Information);
            return;
        }
        new Thread(() =>
        {
            try { CheckForUpdate(manual); }
            catch (Exception ex)
            {
                Log("Error: " + ex.Message);
                if (manual) ShowMsg("No he podido comprobar si hay actualizaciones.\n\n" + ex.Message, MessageBoxIcon.Warning);
            }
            finally { Interlocked.Exchange(ref updateBusy, 0); }
        }) { IsBackground = true }.Start();
    }

    static void CheckForUpdate(bool manual)
    {
        string current, repo;
        ReadPackage(root, out current, out repo);
        var cur = ParseVersion(current);
        if (cur == null) { Log("Versión instalada no válida en package.json: '" + current + "'"); if (manual) ShowMsg("No sé qué versión tienes instalada (package.json no válido).", MessageBoxIcon.Warning); return; }
        var url = ApiUrl(repo);
        if (url == null)
        {
            Log("Sin updateRepo en package.json: no se buscan actualizaciones.");
            if (manual) ShowMsg("Esta copia de LoL Coach no tiene configurado de dónde descargar actualizaciones.", MessageBoxIcon.Information);
            return;
        }
        Log("Buscando actualizaciones en " + url + " (instalada " + CleanVersion(current) + ")");
        ReleaseInfo rel;
        try { rel = FetchLatest(url, current); }
        catch (Exception ex)
        {
            Log("No se ha podido consultar: " + ex.Message);
            if (manual) ShowMsg("No he podido comprobar si hay actualizaciones (¿sin conexión a internet?).\n\n" + ex.Message, MessageBoxIcon.Warning);
            return;
        }
        var remote = ParseVersion(rel.Version);
        if (remote == null) { Log("Versión remota no válida: '" + rel.Version + "'"); if (manual) ShowMsg("La última versión publicada no tiene un número de versión válido.", MessageBoxIcon.Warning); return; }
        if (CompareVersions(remote, cur) <= 0)
        {
            Log("Al día (remota " + rel.Version + ").");
            if (manual) ShowMsg("Ya tienes la última versión de LoL Coach (" + CleanVersion(current) + ").", MessageBoxIcon.Information);
            return;
        }
        if (!manual && SkippedVersion() == rel.Version) { Log("Hay " + rel.Version + " pero el usuario la saltó."); return; }
        if (string.IsNullOrEmpty(rel.ZipUrl))
        {
            Log("La release " + rel.Version + " no tiene un .zip.");
            if (manual) ShowMsg("Hay una versión nueva (" + rel.Version + ") pero no trae el archivo de instalación (.zip).", MessageBoxIcon.Warning);
            return;
        }

        int answer;
        if (Env("LOLCOACH_UPDATE_API") != "" && Env("LOLCOACH_UPDATE_AUTOACCEPT") == "1") { answer = 0; Log("Modo prueba: se acepta la actualización sin preguntar."); }
        else answer = (int)ui.Invoke(new Func<int>(() => AskUpdate(rel.Version, CleanVersion(current))));
        if (answer == 2) { SaveSkippedVersion(rel.Version); Log("El usuario salta la versión " + rel.Version + "."); return; }
        if (answer != 0) { Log("El usuario pospone la actualización."); return; }

        DownloadAndApply(rel, CleanVersion(current), repo);
    }

    // 0 = Sí, 1 = Ahora no, 2 = Saltar esta versión
    static int AskUpdate(string latest, string current)
    {
        using (var f = new Form())
        {
            f.Text = "LoL Coach";
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.MaximizeBox = false; f.MinimizeBox = false;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.TopMost = true;
            f.ShowInTaskbar = true;
            f.AutoScaleMode = AutoScaleMode.Font;
            f.Font = new Font("Segoe UI", 9.5f);
            try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            f.ClientSize = new Size(440, 130);
            var lbl = new Label
            {
                Text = "Hay una versión nueva de LoL Coach (" + latest + "). Tienes la " + current + ".\n¿Actualizar ahora?",
                Location = new Point(16, 16), Size = new Size(408, 56),
            };
            int result = 1;
            var yes = new Button { Text = "Sí", Location = new Point(16, 86), Size = new Size(100, 30) };
            var later = new Button { Text = "Ahora no", Location = new Point(124, 86), Size = new Size(110, 30) };
            var skip = new Button { Text = "Saltar esta versión", Location = new Point(242, 86), Size = new Size(182, 30) };
            yes.Click += (s, e) => { result = 0; f.Close(); };
            later.Click += (s, e) => { result = 1; f.Close(); };
            skip.Click += (s, e) => { result = 2; f.Close(); };
            f.Controls.AddRange(new Control[] { lbl, yes, later, skip });
            f.AcceptButton = yes; f.CancelButton = later;
            f.ShowDialog();
            return result;
        }
    }

    static void ShowMsg(string text, MessageBoxIcon icon)
    {
        Log("Aviso: " + text.Replace("\n", " "));
        if (Env("LOLCOACH_UPDATE_API") != "" && Env("LOLCOACH_UPDATE_AUTOACCEPT") == "1") return; // pruebas automáticas: solo al registro
        Action a = () => MessageBox.Show(text, "LoL Coach", MessageBoxButtons.OK, icon, MessageBoxDefaultButton.Button1, MessageBoxOptions.DefaultDesktopOnly);
        try { if (ui != null && ui.IsHandleCreated) ui.Invoke(a); else a(); } catch { }
    }

    // ---------- Descarga e instalación ----------
    static void DownloadAndApply(ReleaseInfo rel, string current, string repo)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "LoLCoach-update-" + Guid.NewGuid().ToString("N"));
        bool handedOver = false;
        try
        {
            Directory.CreateDirectory(tmp);
            var zip = Path.Combine(tmp, "update.zip");
            var ex = Path.Combine(tmp, "x");
            if (tray != null) tray.ShowBalloonTip(4000, "LoL Coach", "Descargando la versión " + rel.Version + "…", ToolTipIcon.Info);
            Log("Descargando " + rel.ZipUrl);
            var req = MakeRequest(rel.ZipUrl, 30000, "application/octet-stream", current);
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var input = res.GetResponseStream())
            using (var output = File.Create(zip))
                input.CopyTo(output);
            Log("Descargado (" + new FileInfo(zip).Length + " bytes). Descomprimiendo.");

            ExtractZip(zip, ex);
            var staged = Path.Combine(ex, "LoL Coach");
            if (!File.Exists(Path.Combine(staged, "package.json")) || !File.Exists(Path.Combine(staged, "LoL Coach.exe")))
                throw new Exception("el zip no contiene «LoL Coach/package.json» y «LoL Coach/LoL Coach.exe»");
            string newVersion, newRepo;
            ReadPackage(staged, out newVersion, out newRepo);
            if (CleanVersion(newVersion) != rel.Version)
                throw new Exception("el zip trae la versión " + newVersion + " y la release es la " + rel.Version);

            handedOver = true; // a partir de aquí ApplyUpdate se encarga de la carpeta temporal
            ui.Invoke(new Action(() => ApplyUpdate(staged, tmp, rel.Version, current, repo)));
        }
        catch (Exception e)
        {
            Log("Actualización cancelada: " + e.Message);
            if (!handedOver)
            {
                ShowMsg("No se ha podido descargar o comprobar la actualización. No se ha cambiado nada; sigues con la versión " + current + ".\n\n" + e.Message, MessageBoxIcon.Warning);
                TryDeleteDir(tmp);
            }
        }
    }

    static void ExtractZip(string zip, string dest)
    {
        var destFull = Path.GetFullPath(dest).TrimEnd('\\') + "\\";
        Directory.CreateDirectory(destFull);
        using (var z = ZipFile.OpenRead(zip))
        {
            foreach (var entry in z.Entries)
            {
                var full = Path.GetFullPath(Path.Combine(destFull, entry.FullName.Replace('/', '\\')));
                if (!full.StartsWith(destFull, StringComparison.OrdinalIgnoreCase)) throw new Exception("ruta no válida en el zip: " + entry.FullName);
                if (entry.Name == "") { Directory.CreateDirectory(full); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(full));
                entry.ExtractToFile(full, true);
            }
        }
    }

    static bool IsProtected(string rel)
    {
        var r = rel.Replace('/', '\\');
        return r.Equals("data", StringComparison.OrdinalIgnoreCase)
            || r.StartsWith("data\\", StringComparison.OrdinalIgnoreCase)
            || r.Equals(".env", StringComparison.OrdinalIgnoreCase)
            || r.Equals("LoL Coach.old.exe", StringComparison.OrdinalIgnoreCase);
    }

    static string RelPath(string baseDir, string file)
    {
        return file.Substring(baseDir.TrimEnd('\\').Length).TrimStart('\\');
    }

    // Hilo de la interfaz. Si sale bien, relanza y cierra este proceso.
    static void ApplyUpdate(string staged, string tmp, string version, string current, string repo)
    {
        updating = true;
        Log("Instalando " + version + ": parando overlay y servidor.");
        try { StopOverlay(); } catch { }
        StopServer();
        KillBundledNode();

        var backupDir = Path.Combine(root, "data", "update-backup");
        TryDeleteDir(backupDir);
        var moved = new List<KeyValuePair<string, string>>(); // original -> copia de seguridad
        var created = new List<string>();
        var exePath = Path.Combine(root, "LoL Coach.exe");
        var oldExe = Path.Combine(root, "LoL Coach.old.exe");
        try
        {
            var files = new List<string>();
            var newSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in Directory.GetFiles(staged, "*", SearchOption.AllDirectories))
            {
                var rel = RelPath(staged, f);
                if (IsProtected(rel)) continue;
                files.Add(rel);
                newSet.Add(rel);
            }

            // Código de la app que ya no viene en la versión nueva (solo src\ y public\, que no son del usuario)
            foreach (var dir in new[] { "src", "public" })
            {
                var d = Path.Combine(root, dir);
                if (!Directory.Exists(d) || !Directory.Exists(Path.Combine(staged, dir))) continue;
                foreach (var f in Directory.GetFiles(d, "*", SearchOption.AllDirectories))
                {
                    var rel = RelPath(root, f);
                    if (newSet.Contains(rel)) continue;
                    var bak = Path.Combine(backupDir, rel);
                    Directory.CreateDirectory(Path.GetDirectoryName(bak));
                    File.Move(f, bak);
                    moved.Add(new KeyValuePair<string, string>(f, bak));
                }
            }

            foreach (var rel in files)
            {
                var target = Path.Combine(root, rel);
                if (File.Exists(target))
                {
                    var bak = string.Equals(target, exePath, StringComparison.OrdinalIgnoreCase) ? oldExe : Path.Combine(backupDir, rel);
                    if (File.Exists(bak)) File.Delete(bak);
                    Directory.CreateDirectory(Path.GetDirectoryName(bak));
                    File.Move(target, bak); // funciona aunque el archivo esté en uso (el exe actual)
                    moved.Add(new KeyValuePair<string, string>(target, bak));
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(Path.Combine(staged, rel), target, false);
                created.Add(target);
            }
            Log("Archivos sustituidos: " + files.Count + " (copias de seguridad: " + moved.Count + ").");
        }
        catch (Exception e)
        {
            Log("Fallo al instalar: " + e.Message + ". Deshaciendo cambios.");
            bool restored = true;
            for (int i = created.Count - 1; i >= 0; i--) { try { File.Delete(created[i]); } catch { restored = false; } }
            for (int i = moved.Count - 1; i >= 0; i--)
            {
                try
                {
                    if (File.Exists(moved[i].Key)) File.Delete(moved[i].Key);
                    File.Move(moved[i].Value, moved[i].Key);
                }
                catch { restored = false; }
            }
            TryDeleteDir(tmp);
            updating = false;
            if (restored)
            {
                TryDeleteDir(backupDir);
                Log("Cambios deshechos; se sigue con la versión " + current + ".");
                if (!PortOpen()) StartServer();
                StartOverlay();
                ShowMsg("No se ha podido instalar la actualización y se han deshecho los cambios. Sigues con la versión " + current + ".\n\n" + e.Message, MessageBoxIcon.Warning);
            }
            else
            {
                Log("No se han podido deshacer todos los cambios. Copias en " + backupDir);
                var url = repo != "" ? "https://github.com/" + repo + "/releases" : "la página de descargas";
                ShowMsg("La actualización ha fallado a medias y LoL Coach puede no funcionar bien.\n\nDescarga de nuevo la última versión desde " + url + " y descomprímela encima de esta carpeta (tus datos de la carpeta «data» se conservan). Las copias de los archivos antiguos están en:\n" + backupDir + "\n\n" + e.Message, MessageBoxIcon.Error);
                if (!PortOpen()) { try { StartServer(); } catch { } }
            }
            return;
        }

        TryDeleteDir(tmp);
        TryDeleteDir(backupDir); // si algo sigue bloqueado, se borra en el próximo arranque
        Log("Actualizado a " + version + ". Relanzando.");
        try
        {
            Process.Start(new ProcessStartInfo(exePath, "--after-update") { WorkingDirectory = root, UseShellExecute = false });
        }
        catch (Exception e)
        {
            Log("No se ha podido relanzar: " + e.Message);
            ShowMsg("LoL Coach se ha actualizado a la versión " + version + ". Vuelve a abrirlo.", MessageBoxIcon.Information);
        }
        Exit();
    }

    // Por si hay un servidor de esta instalación que no arrancamos nosotros (bloquearía runtime\node.exe)
    static void KillBundledNode()
    {
        var bundled = Path.GetFullPath(Path.Combine(root, "runtime", "node.exe"));
        foreach (var p in Process.GetProcessesByName("node"))
        {
            try
            {
                if (string.Equals(Path.GetFullPath(p.MainModule.FileName), bundled, StringComparison.OrdinalIgnoreCase))
                {
                    Log("Parando otro servidor de esta instalación (PID " + p.Id + ").");
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    static bool TryDeleteDir(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); return true; }
        catch { return false; }
    }

    // Restos de una actualización anterior (el exe viejo puede tardar un poco en soltarse)
    static void CleanupAfterUpdate()
    {
        new Thread(() =>
        {
            var oldExe = Path.Combine(root, "LoL Coach.old.exe");
            var backupDir = Path.Combine(root, "data", "update-backup");
            for (int i = 0; i < 20; i++)
            {
                bool ok = true;
                try { if (File.Exists(oldExe)) { File.Delete(oldExe); Log("Borrado LoL Coach.old.exe de la versión anterior."); } } catch { ok = false; }
                if (!TryDeleteDir(backupDir)) ok = false;
                if (ok) break;
                Thread.Sleep(500);
            }
            try
            {
                foreach (var d in Directory.GetDirectories(Path.GetTempPath(), "LoLCoach-update-*"))
                    if (Directory.GetCreationTime(d) < DateTime.Now.AddMinutes(-10)) TryDeleteDir(d);
            }
            catch { }
        }) { IsBackground = true }.Start();
    }

    // LoL Coach.exe --update-check-test salida.txt
    static void UpdateCheckTest(string outFile)
    {
        var sb = new StringBuilder();
        try
        {
            sb.AppendLine("carpeta: " + root);
            sb.AppendLine("empaquetada: " + (IsPackaged() ? "sí" : "no"));
            if (!IsPackaged()) { sb.AppendLine("accion: nada (sin runtime\\node.exe)"); return; }
            string current, repo;
            ReadPackage(root, out current, out repo);
            sb.AppendLine("instalada: " + current);
            sb.AppendLine("updateRepo: " + repo);
            var url = ApiUrl(repo);
            if (url == null) { sb.AppendLine("accion: nada (sin updateRepo)"); return; }
            sb.AppendLine("api: " + url);
            ReleaseInfo rel;
            var t = Stopwatch.StartNew();
            try { rel = FetchLatest(url, current); }
            catch (Exception ex) { sb.AppendLine("accion: nada (error de red tras " + t.ElapsedMilliseconds + " ms: " + ex.Message + ")"); return; }
            sb.AppendLine("remota: " + rel.Version);
            sb.AppendLine("zip: " + (rel.ZipName ?? "(ninguno)") + " " + (rel.ZipUrl ?? ""));
            sb.AppendLine("saltada: " + SkippedVersion());
            var a = ParseVersion(rel.Version); var b = ParseVersion(current);
            if (a == null || b == null) sb.AppendLine("accion: nada (versión no válida)");
            else if (CompareVersions(a, b) <= 0) sb.AppendLine("accion: nada (al día)");
            else if (SkippedVersion() == rel.Version) sb.AppendLine("accion: nada (versión saltada; «Buscar actualizaciones» sí preguntaría)");
            else if (string.IsNullOrEmpty(rel.ZipUrl)) sb.AppendLine("accion: nada (la release no trae .zip)");
            else sb.AppendLine("accion: preguntar «Hay una versión nueva de LoL Coach (" + rel.Version + "). Tienes la " + CleanVersion(current) + ". ¿Actualizar ahora?»");
        }
        catch (Exception ex) { sb.AppendLine("error: " + ex.Message); }
        finally
        {
            try { File.WriteAllText(outFile, sb.ToString(), new UTF8Encoding(false)); } catch { }
            try { Console.Write(sb.ToString()); } catch { }
        }
    }
}
