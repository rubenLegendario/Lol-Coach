// LoL Coach — overlay encima del juego.
// Ventana transparente, siempre encima y que deja pasar los clics (no interfiere con el juego).
// Solo se muestra mientras la ventana del LoL está en primer plano. Lee los datos de /api/overlay.
// No lee memoria ni inyecta nada en el juego: solo pinta encima, como cualquier overlay de escritorio.
//
// Modo colocar (Ajustes > Overlay > Mover widgets): la ventana deja de ignorar el ratón en los widgets,
// se pueden arrastrar y la posición se guarda en los ajustes de la app. «Bloquear» vuelve al modo normal.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class OverlayForm : Form
{
    readonly int port;
    volatile Dictionary<string, object> data;
    DateTime dataAt = DateTime.MinValue;
    readonly System.Windows.Forms.Timer ui;
    bool running = true;
    Rectangle lastRect = Rectangle.Empty;
    string lastFrame = "";

    // Modo colocar
    public static volatile bool Editing;
    bool clickThrough = true;
    Dictionary<string, RectangleF> boxes = new Dictionary<string, RectangleF>();
    readonly Dictionary<string, PointF> moved = new Dictionary<string, PointF>(); // posición mientras se arrastra (fracción)
    string dragging;
    PointF dragOffset;
    string lastPosJson = "";
    // Candado dentro del overlay: aparece al dejar el ratón sobre un widget
    readonly System.Windows.Forms.Timer hoverTimer;
    string hover;
    DateTime hoverSince = DateTime.MinValue;
    bool lockShown;
    bool? pendingEdit;          // respuesta inmediata al pulsar el candado, hasta que llegan los datos nuevos
    DateTime pendingUntil = DateTime.MinValue;
    static readonly string[] Widgets = { "cs", "timers", "skill", "back", "loadAlly", "loadEnemy" };

    // Colores de la app
    static readonly Color Bg = Color.FromArgb(128, 8, 11, 17);
    static readonly Color Line = Color.FromArgb(30, 255, 255, 255);
    static readonly Color Gold = Color.FromArgb(255, 243, 215, 156);
    static readonly Color GoldLine = Color.FromArgb(60, 210, 167, 91);
    static readonly Color WinLine = Color.FromArgb(80, 47, 214, 144);
    static readonly Color Fg = Color.FromArgb(255, 237, 241, 247);
    static readonly Color Muted = Color.FromArgb(255, 150, 160, 178);
    static readonly Color Win = Color.FromArgb(255, 47, 214, 144);
    static readonly Color Loss = Color.FromArgb(255, 255, 84, 104);
    static readonly Color Ally = Color.FromArgb(255, 74, 169, 255);
    static readonly Color Warn = Color.FromArgb(255, 255, 182, 72);

    static readonly Dictionary<string, string> WidgetSetting = new Dictionary<string, string> {
        { "cs", "overlay.posCs" }, { "timers", "overlay.posTimers" }, { "skill", "overlay.posSkill" },
        { "back", "overlay.posBack" }, { "loadAlly", "overlay.posLoadAlly" }, { "loadEnemy", "overlay.posLoadEnemy" } };
    static readonly Dictionary<string, string> WidgetName = new Dictionary<string, string> {
        { "cs", "Contador de CS" }, { "timers", "Timers" }, { "skill", "Habilidad" },
        { "back", "Vuelve a base" }, { "loadAlly", "Tu equipo" }, { "loadEnemy", "Rivales" } };

    public OverlayForm(int port)
    {
        this.port = port;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(0, 0, 10, 10);

        new Thread(FetchLoop) { IsBackground = true }.Start();
        ui = new System.Windows.Forms.Timer { Interval = 250 };
        ui.Tick += (s, e) => Tick();
        ui.Start();
        hoverTimer = new System.Windows.Forms.Timer { Interval = 60 };
        hoverTimer.Tick += (s, e) => HoverTick();
        hoverTimer.Start();
    }

    // Atajo global: Ctrl+Mayús+L bloquea / desbloquea el overlay
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, int mods, int vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try { RegisterHotKey(Handle, 1, 0x2 | 0x4 | 0x4000, (int)Keys.L); } catch { }
    }
    protected override void OnHandleDestroyed(EventArgs e)
    {
        try { UnregisterHotKey(Handle, 1); } catch { }
        base.OnHandleDestroyed(e);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 && m.WParam.ToInt32() == 1 && Visible) ToggleLock();
        base.WndProc(ref m);
    }

    void ToggleLock()
    {
        bool next = !Editing;
        pendingEdit = next;
        pendingUntil = DateTime.UtcNow.AddSeconds(2.5);
        PostSetting(port, "overlay.locked", next ? "false" : "true");
        lastFrame = "";
        Tick();
    }

    /** Detecta el ratón encima de los widgets; solo el candado (y todo en modo colocar) recibe clics. */
    void HoverTick()
    {
        if (!Visible) { hover = null; lockShown = false; SetClickThrough(true); return; }
        var p = PointToClient(Cursor.Position);
        string over = null;
        RectangleF r;
        foreach (var k in Widgets)
        {
            if (!boxes.TryGetValue(k, out r)) continue;
            RectangleF lr;
            // La zona incluye el candado, para poder llegar a él sin que desaparezca
            var zone = boxes.TryGetValue("lock:" + k, out lr) ? RectangleF.Union(RectangleF.Inflate(r, 4, 4), RectangleF.Inflate(lr, 4, 4)) : RectangleF.Inflate(r, 4, 4);
            if (zone.Contains(p)) over = k;
        }
        if (over != hover) { hover = over; hoverSince = DateTime.UtcNow; }
        bool show = hover != null && (Editing || (DateTime.UtcNow - hoverSince).TotalMilliseconds > 450);
        if (show != lockShown) { lockShown = show; lastFrame = ""; Tick(); }
        bool onLock = lockShown && boxes.TryGetValue("lock:" + hover, out r) && r.Contains(p);
        foreach (var kv in boxes) if (kv.Key.StartsWith("x:") && RectangleF.Inflate(kv.Value, 3, 3).Contains(p)) onLock = true;
        SetClickThrough(!(Editing || onLock));
        if (!Editing) Cursor = onLock ? Cursors.Hand : Cursors.Default;
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST
            cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8;
            return cp;
        }
    }

    public void Stop()
    {
        running = false;
        ui.Stop();
    }

    void FetchLoop()
    {
        var json = new JavaScriptSerializer();
        while (running)
        {
            try
            {
                using (var wc = new WebClient { Encoding = Encoding.UTF8 })
                {
                    var text = wc.DownloadString("http://127.0.0.1:" + port + "/api/overlay");
                    data = json.Deserialize<Dictionary<string, object>>(text);
                    dataAt = DateTime.UtcNow;
                }
            }
            catch { data = null; }
            Thread.Sleep(Editing ? 300 : 700);
        }
    }

    /** Guarda un ajuste en la app (en segundo plano). */
    public static void PostSetting(int port, string path, string jsonValue)
    {
        new Thread(() =>
        {
            try
            {
                using (var wc = new WebClient { Encoding = Encoding.UTF8 })
                {
                    wc.Headers[HttpRequestHeader.ContentType] = "application/json";
                    wc.UploadString("http://127.0.0.1:" + port + "/api/settings", "{\"path\":\"" + path + "\",\"value\":" + jsonValue + "}");
                }
            }
            catch { }
        }) { IsBackground = true }.Start();
    }

    // ---------- Ventana del juego ----------
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int idx, int val);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int W, H; public SIZE(int w, int h) { W = w; H = h; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }

    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pprSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);

    Rectangle GameRect(bool edit, bool preview)
    {
        var h = FindWindow(null, "League of Legends (TM) Client");
        if (h == IntPtr.Zero || IsIconic(h))
        {
            // Modo colocar sin partida: sobre la pantalla principal
            return edit && preview ? Screen.PrimaryScreen.Bounds : Rectangle.Empty;
        }
        // En modo colocar se ve aunque el juego no esté en primer plano (para poder pulsar «Bloquear» en la app)
        var fg = GetForegroundWindow();
        if (!edit && fg != h && fg != Handle) return Rectangle.Empty;
        RECT r;
        if (!GetClientRect(h, out r)) return Rectangle.Empty;
        var p = new POINT(0, 0);
        ClientToScreen(h, ref p);
        return new Rectangle(p.X, p.Y, r.Right - r.Left, r.Bottom - r.Top);
    }

    void SetClickThrough(bool on)
    {
        if (on == clickThrough || !IsHandleCreated) return;
        int ex = GetWindowLong(Handle, -20);
        SetWindowLong(Handle, -20, on ? ex | 0x20 : ex & ~0x20);
        clickThrough = on;
    }

    // ---------- Bucle de pintado ----------
    void Tick()
    {
        var d = data;
        bool active = d != null && d.ContainsKey("active") && (bool)d["active"];
        bool edit = active && d.ContainsKey("edit") && d["edit"] is bool && (bool)d["edit"];
        if (pendingEdit.HasValue)
        {
            if (DateTime.UtcNow > pendingUntil || pendingEdit.Value == edit) pendingEdit = null;
            else edit = active && pendingEdit.Value;
        }
        bool preview = active && d.ContainsKey("preview") && d["preview"] is bool && (bool)d["preview"];
        Editing = edit;
        if (!edit && dragging != null) dragging = null;

        var rect = active ? GameRect(edit, preview) : Rectangle.Empty;
        if (!active || rect.Width < 200 || rect.Height < 200)
        {
            if (Visible) Hide();
            lastFrame = "";
            return;
        }

        // Si cambian las posiciones guardadas (p. ej. «Restablecer»), olvidamos las locales
        var json = new JavaScriptSerializer();
        var posJson = d.ContainsKey("pos") ? json.Serialize(d["pos"]) : "";
        if (posJson != lastPosJson && dragging == null) { moved.Clear(); lastPosJson = posJson; }

        double gameTime = Num(d, "gameTime") + (preview ? 0 : Math.Min(3, (DateTime.UtcNow - dataAt).TotalSeconds));
        // Solo repintamos si cambia algo visible (el reloj va por segundos)
        var frame = rect + "|" + (int)gameTime + "|" + json.Serialize(d["cs"]) + "|" + d["skill"] + "|" + edit + "|" + Dismissed.Count + "|" + ImagesLoaded + "|" + (d.ContainsKey("back") ? json.Serialize(d["back"]) : "") + (d.ContainsKey("loading") ? json.Serialize(d["loading"]) : "") + "|" + hover + lockShown + "|" + posJson + "|" + json.Serialize(moved);
        if (frame == lastFrame && Visible) return;
        lastFrame = frame;
        if (!Visible) Show();
        if (rect != lastRect) { Bounds = rect; lastRect = rect; }

        using (var bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);
                boxes = Draw(g, d, gameTime, rect.Width, rect.Height, moved, edit, preview, lockShown ? hover : null);
            }
            Push(bmp, rect.Location);
        }
    }

    // ---------- Ratón (solo en modo colocar) ----------
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        RectangleF r;
        foreach (var k in boxes.Keys)
        {
            if (k.StartsWith("x:") && RectangleF.Inflate(boxes[k], 3, 3).Contains(e.Location))
            {
                Dismissed.Add(k.Substring(2));
                lastFrame = "";
                Tick();
                return;
            }
            if ((k == "lock" || k.StartsWith("lock:")) && boxes[k].Contains(e.Location) && (Editing || k == "lock:" + hover))
            {
                ToggleLock();
                return;
            }
        }
        if (!Editing) return;
        foreach (var k in new[] { "skill", "back", "timers", "cs", "loadAlly", "loadEnemy" })
        {
            if (boxes.TryGetValue(k, out r) && r.Contains(e.Location))
            {
                dragging = k;
                dragOffset = new PointF(e.X - r.X, e.Y - r.Y);
                Capture = true;
                return;
            }
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!Editing) return;
        if (dragging == null)
        {
            bool over = false;
            foreach (var b in boxes.Values) if (b.Contains(e.Location)) over = true;
            Cursor = over ? Cursors.SizeAll : Cursors.Default;
            return;
        }
        RectangleF r = boxes[dragging];
        float x = Math.Max(0, Math.Min(Width - r.Width, e.X - dragOffset.X));
        float y = Math.Max(0, Math.Min(Height - r.Height, e.Y - dragOffset.Y));
        x = PlaceSaved(dragging, x, r.Width, Width);
        moved[dragging] = new PointF(x / Width, y / Height);
        Tick();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (dragging == null) return;
        PointF p;
        if (moved.TryGetValue(dragging, out p))
        {
            var ci = System.Globalization.CultureInfo.InvariantCulture;
            PostSetting(port, WidgetSetting[dragging], "{\"x\":" + p.X.ToString("0.0000", ci) + ",\"y\":" + p.Y.ToString("0.0000", ci) + "}");
        }
        dragging = null;
        Capture = false;
    }

    /** Tamaño de los widgets respecto a la pantalla (más pequeño = más discreto). */
    const float Compact = 0.82f;
    /** Escala de la pantalla (1 = 1080p): para colocar los widgets por defecto respecto al HUD del juego. */
    static float S = 1;

    static Dictionary<string, RectangleF> Draw(Graphics g, Dictionary<string, object> d, double gameTime, int w, int h, Dictionary<string, PointF> moved, bool edit, bool preview, string lockOn = null)
    {
        S = h / 1080f;
        float s = S * Compact;
        var boxes = new Dictionary<string, RectangleF>();
        if (edit)
        {
            // Velo suave para que se note que estás en modo colocar
            using (var veil = new SolidBrush(Color.FromArgb(preview ? 70 : 40, 0, 0, 0))) g.FillRectangle(veil, 0, 0, w, h);
        }
        RectangleF r;
        r = DrawCs(g, d, s, w, h, moved); if (!r.IsEmpty) boxes["cs"] = r;
        r = DrawTimers(g, d, gameTime, s, w, h, moved, edit, boxes); if (!r.IsEmpty) boxes["timers"] = r;
        r = DrawSkill(g, d, s, w, h, moved); if (!r.IsEmpty) boxes["skill"] = r;
        r = DrawBack(g, d, s, w, h, moved, edit, boxes); if (!r.IsEmpty) boxes["back"] = r;
        r = DrawLoading(g, d, s, w, h, moved, edit, boxes, "ally"); if (!r.IsEmpty) boxes["loadAlly"] = r;
        r = DrawLoading(g, d, s, w, h, moved, edit, boxes, "enemy"); if (!r.IsEmpty) boxes["loadEnemy"] = r;
        if (edit)
        {
            foreach (var kv in boxes) EditFrame(g, kv.Value, WidgetName[kv.Key], s);
            boxes["lock"] = EditBanner(g, S, w, preview);
        }
        // Candado en la esquina de cada widget (siempre en modo colocar; si no, solo en el que tiene el ratón)
        foreach (var k in Widgets)
        {
            RectangleF wr;
            if (!boxes.TryGetValue(k, out wr)) continue;
            // Fuera del widget, encima de su esquina derecha (debajo si no cabe arriba)
            var lr = new RectangleF(wr.Right - 22 * s, wr.Y - 28 * s, 22 * s, 22 * s);
            if (lr.Y < 0) lr.Y = wr.Bottom + 6 * s;
            boxes["lock:" + k] = lr;
            if (edit || lockOn == k) DrawLock(g, lr, s, !edit);
        }
        return boxes;
    }

    /** Modo de prueba: pinta el overlay con los datos actuales sobre un fondo y lo guarda como PNG. */
    public static void RenderTest(int port, string file, int w, int h)
    {
        var text = new WebClient { Encoding = Encoding.UTF8 }.DownloadString("http://127.0.0.1:" + port + "/api/overlay");
        var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
        using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (var bg = new LinearGradientBrush(new Rectangle(0, 0, w, h), Color.FromArgb(255, 40, 60, 45), Color.FromArgb(255, 25, 35, 55), 45f)) g.FillRectangle(bg, 0, 0, w, h);
            bool edit = d.ContainsKey("edit") && d["edit"] is bool && (bool)d["edit"];
            bool preview = d.ContainsKey("preview") && d["preview"] is bool && (bool)d["preview"];
            // Primera pasada para lanzar la descarga de iconos; la segunda ya los pinta
            using (var tmp = new Bitmap(w, h)) using (var tg = Graphics.FromImage(tmp)) Draw(tg, d, Num(d, "gameTime"), w, h, new Dictionary<string, PointF>(), edit, preview);
            Thread.Sleep(3000);
            Draw(g, d, Num(d, "gameTime"), w, h, new Dictionary<string, PointF>(), edit, preview);
            bmp.Save(file, ImageFormat.Png);
        }
    }

    void Push(Bitmap bmp, Point at)
    {
        IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), hbmp = bmp.GetHbitmap(Color.FromArgb(0)), old = SelectObject(mem, hbmp);
        try
        {
            var size = new SIZE(bmp.Width, bmp.Height);
            var src = new POINT(0, 0);
            var dst = new POINT(at.X, at.Y);
            var blend = new BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
            UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2);
        }
        finally
        {
            SelectObject(mem, old);
            DeleteObject(hbmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }

    // ---------- Widgets ----------
    static Font F(float size, bool bold, float s)
    {
        string fam = bold ? "Bahnschrift SemiBold" : "Segoe UI";
        try { return new Font(fam, size * s, bold ? FontStyle.Regular : FontStyle.Regular, GraphicsUnit.Pixel); }
        catch { return new Font("Segoe UI", size * s, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel); }
    }

    static GraphicsPath Round(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    static void Card(Graphics g, RectangleF r, float s, Color border)
    {
        using (var path = Round(r, 10 * s))
        using (var bg = new SolidBrush(Bg))
        using (var pen = new Pen(border, Math.Max(1, 1f * s)))
        {
            g.FillPath(bg, path);
            g.DrawPath(pen, path);
        }
    }

    static void Txt(Graphics g, string t, Font f, Color c, float x, float y)
    {
        using (var sh = new SolidBrush(Color.FromArgb(Math.Min(150, (int)c.A), 0, 0, 0))) g.DrawString(t, f, sh, x + 1, y + 1);
        using (var b = new SolidBrush(c)) g.DrawString(t, f, b, x, y);
    }

    static double Num(Dictionary<string, object> d, string k)
    {
        object v;
        if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
        return Convert.ToDouble(v);
    }

    static string Clock(double secs)
    {
        if (secs < 0) secs = 0;
        int t = (int)Math.Ceiling(secs);
        return (t / 60) + ":" + (t % 60).ToString("00");
    }

    /** Coloca un widget: posición arrastrada > posición guardada > sitio por defecto. Siempre dentro de la pantalla. */
    static RectangleF Place(Dictionary<string, object> d, Dictionary<string, PointF> moved, string name, SizeF size, PointF def, int w, int h)
    {
        return Place(d, moved, name, size, def, w, h, 0, 0);
    }

    /// <summary>
    /// Ancho de referencia (px) de los widgets anclables por la derecha, para que el arrastre guarde la posición
    /// con el mismo criterio que usa Place (ver PlaceSaved).
    /// </summary>
    static readonly Dictionary<string, float> RefWidth = new Dictionary<string, float>();

    /// <summary>
    /// Con refW &gt; 0 el widget se ancla por el lado más cercano de la pantalla. La posición guardada sigue siendo
    /// la esquina superior izquierda de una caja de ancho fijo refW (compatible con lo ya guardado):
    /// si el centro de esa caja cae en la mitad derecha, el borde derecho del widget es x + refW y el widget crece
    /// hacia la izquierda; así su borde derecho no se mueve aunque el ancho real cambie. margin: hueco con los bordes.
    /// </summary>
    static RectangleF Place(Dictionary<string, object> d, Dictionary<string, PointF> moved, string name, SizeF size, PointF def, int w, int h, float refW, float margin)
    {
        PointF p = def;
        PointF m;
        if (moved != null && moved.TryGetValue(name, out m)) p = new PointF(m.X * w, m.Y * h);
        else
        {
            var pos = d.ContainsKey("pos") ? d["pos"] as Dictionary<string, object> : null;
            var v = pos != null && pos.ContainsKey(name) ? pos[name] as Dictionary<string, object> : null;
            if (v != null) p = new PointF((float)Num(v, "x") * w, (float)Num(v, "y") * h);
        }
        if (refW > 0)
        {
            RefWidth[name] = refW;
            if (p.X + refW / 2 > w / 2f) p.X = Math.Min(p.X + refW, w - margin) - size.Width;
        }
        p.X = Math.Max(margin, Math.Min(w - size.Width - margin, p.X));
        p.Y = Math.Max(margin, Math.Min(h - size.Height - margin, p.Y));
        return new RectangleF(p, size);
    }

    /// <summary>Posición a guardar (x en px) para un widget arrastrado cuya caja real empieza en x y mide width.</summary>
    static float PlaceSaved(string name, float x, float width, int w)
    {
        float refW;
        if (!RefWidth.TryGetValue(name, out refW) || refW <= 0) return x;
        // Mitad derecha: guarda la caja de referencia que termina donde termina el widget (ancla derecha)
        float right = x + width - refW;
        if (right + refW / 2 > w / 2f) return right;
        // Mitad izquierda (ancla izquierda). Cerca del centro, sin pasar al criterio de la derecha
        return Math.Min(x, w / 2f - refW / 2);
    }

    static void EditFrame(Graphics g, RectangleF r, string name, float s)
    {
        var o = RectangleF.Inflate(r, 5 * s, 5 * s);
        using (var path = Round(o, 13 * s))
        using (var pen = new Pen(Gold, Math.Max(1.5f, 2 * s)) { DashStyle = DashStyle.Dash })
            g.DrawPath(pen, path);
        using (var f = F(12, true, s))
        {
            var t = "✥ " + name;
            var sz = g.MeasureString(t, f);
            var tag = new RectangleF(o.X, o.Y - sz.Height - 6 * s, sz.Width + 12 * s, sz.Height + 4 * s);
            if (tag.Y < 0) tag.Y = o.Bottom + 4 * s;
            using (var path = Round(tag, 6 * s))
            using (var b = new SolidBrush(Gold)) g.FillPath(b, path);
            Txt(g, t, f, Color.FromArgb(255, 27, 19, 6), tag.X + 6 * s, tag.Y + 2 * s);
        }
    }

    /** Candado: cerrado (bloqueado) o abierto (modo colocar). */
    static void DrawLock(Graphics g, RectangleF r, float s, bool locked)
    {
        using (var path = Round(r, 6 * s))
        using (var b = new SolidBrush(locked ? Color.FromArgb(200, 20, 26, 36) : Gold))
        using (var pen = new Pen(Color.FromArgb(90, 255, 255, 255), Math.Max(1, s)))
        {
            g.FillPath(b, path);
            if (locked) g.DrawPath(pen, path);
        }
        Color c = locked ? Fg : Color.FromArgb(255, 27, 19, 6);
        float cx = r.X + r.Width / 2, bw = 9 * s, bh = 7 * s, by = r.Y + 9 * s;
        using (var b = new SolidBrush(c)) g.FillRectangle(b, cx - bw / 2, by, bw, bh);
        using (var pen = new Pen(c, Math.Max(1.2f, 1.6f * s)))
        {
            float aw = 6 * s, ah = 7 * s;
            // Arco del candado: abierto = desplazado hacia arriba a la derecha
            if (locked) g.DrawArc(pen, cx - aw / 2, by - ah / 2 - 1 * s, aw, ah, 180, 180);
            else g.DrawArc(pen, cx - aw / 2 + 3 * s, by - ah / 2 - 3 * s, aw, ah, 180, 180);
            g.DrawLine(pen, cx - aw / 2 + (locked ? 0 : 3 * s), by - (locked ? 1 * s : 3 * s), cx - aw / 2 + (locked ? 0 : 3 * s), by);
            if (locked) g.DrawLine(pen, cx + aw / 2, by - 1 * s, cx + aw / 2, by);
        }
    }

    /** Aviso del modo colocar con el botón «Bloquear». Devuelve el rectángulo del botón. */
    static RectangleF EditBanner(Graphics g, float s, int w, bool preview)
    {
        using (Font f = F(15, false, s), fb = F(16, true, s))
        {
            string t = preview ? "Arrastra los widgets (vista previa sin partida) · Ctrl+Mayús+L" : "Arrastra los widgets · Ctrl+Mayús+L";
            var tsz = g.MeasureString(t, f);
            var bsz = g.MeasureString("Bloquear", fb);
            float bw = bsz.Width + 36 * s, hgt = 46 * s;
            float total = tsz.Width + bw + 40 * s;
            var r = new RectangleF((w - total) / 2, 110 * s, total, hgt);
            Card(g, r, s, GoldLine);
            Txt(g, t, f, Fg, r.X + 16 * s, r.Y + (hgt - tsz.Height) / 2);
            var btn = new RectangleF(r.Right - bw - 7 * s, r.Y + 7 * s, bw, hgt - 14 * s);
            using (var path = Round(btn, 8 * s))
            using (var b = new SolidBrush(Gold)) g.FillPath(b, path);
            Txt(g, "Bloquear", fb, Color.FromArgb(255, 27, 19, 6), btn.X + (btn.Width - bsz.Width) / 2, btn.Y + (btn.Height - bsz.Height) / 2);
            return btn;
        }
    }

    // CS y comparativa con tu rango: una tira de una línea (arriba a la izquierda por defecto)
    //   CS 120  8,0▲   KDA 3,5▲   VIS 0,55▼   Caitlyn ±0   ≈PLATINO
    // Flecha verde: igual o mejor que lo habitual en ese rango; ámbar: un poco por debajo; roja: claramente por debajo.
    // «≈» delante del rango: la referencia de ese rango es una estimación propia.
    static Color BenchColor(double ratio) { return ratio >= 1 ? Win : ratio >= 0.9 ? Warn : Loss; }

    class Seg
    {
        public string Text; public Font Font; public Color Color; public int Arrow; public Color ArrowColor; public float Gap;
        /** Texto de ancho máximo esperado (p. ej. "888"): reserva ese hueco para que la tira no cambie de ancho con los números. */
        public string Template;
        public Seg(string t, Font f, Color c, int arrow, Color ac, float gap) { Text = t; Font = f; Color = c; Arrow = arrow; ArrowColor = ac; Gap = gap; }
        public Seg(string t, Font f, Color c, int arrow, Color ac, float gap, string template) : this(t, f, c, arrow, ac, gap) { Template = template; }
    }

    /** Ancho reservado de un segmento: el mayor entre su texto y su plantilla. */
    static float SegSlot(Graphics g, Seg sg, StringFormat fmt)
    {
        float tw = g.MeasureString(sg.Text, sg.Font, PointF.Empty, fmt).Width;
        if (sg.Template != null) tw = Math.Max(tw, g.MeasureString(sg.Template, sg.Font, PointF.Empty, fmt).Width);
        return tw;
    }

    static float SegsWidth(Graphics g, List<Seg> segs, float s, float arrowW, StringFormat fmt)
    {
        float x = 0;
        foreach (var sg in segs)
        {
            x += SegSlot(g, sg, fmt);
            if (sg.Arrow != 0) x += arrowW + 2 * s;
            x += sg.Gap * s;
        }
        if (segs.Count > 0) x -= segs[segs.Count - 1].Gap * s;
        return x;
    }

    /** Abreviatura del rango (las etiquetas vienen en español: "Platino", "Maestro+"…). Plata y Platino, completas para no confundirlas. */
    static string TierShort(string t)
    {
        if (string.IsNullOrEmpty(t)) return null;
        switch (t.Trim().ToLowerInvariant())
        {
            case "hierro": return "HIE";
            case "bronce": return "BRO";
            case "plata": return "PLATA";
            case "oro": return "ORO";
            case "platino": return "PLATINO";
            case "esmeralda": return "ESM";
            case "diamante": return "DIA";
            case "maestro": case "maestro+": return "MAE+";
            case "gran maestro": return "GM";
            case "aspirante": return "ASP";
        }
        var u = t.Trim().ToUpperInvariant();
        return u.Length > 4 ? u.Substring(0, 4) : u;
    }

    static RectangleF DrawCs(Graphics g, Dictionary<string, object> d, float s, int w, int h, Dictionary<string, PointF> moved)
    {
        var cs = d.ContainsKey("cs") ? d["cs"] as Dictionary<string, object> : null;
        if (cs == null) return RectangleF.Empty;
        var bench = cs.ContainsKey("bench") ? cs["bench"] as Dictionary<string, object> : null;
        var rows = bench != null ? bench["rows"] as ArrayList : null;
        var fmt = StringFormat.GenericTypographic;
        // Plantillas de ancho máximo con el formato de número del sistema (coma decimal en español)
        string t1 = (8.8).ToString("0.0"), t2 = (0.88).ToString("0.00");
        using (Font lbl = F(12.5f, false, s), val = F(18, true, s), num = F(15.5f, true, s), tag = F(11, true, s), apx = new Font("Segoe UI", 15 * s, FontStyle.Bold, GraphicsUnit.Pixel))
        {
            var segs = new List<Seg>();
            segs.Add(new Seg("CS", lbl, Muted, 0, Color.Empty, 5));
            segs.Add(new Seg(((int)Num(cs, "me")).ToString(), val, Fg, 0, Color.Empty, 7, "888"));
            Dictionary<string, object> csRow = null;
            if (rows != null) foreach (Dictionary<string, object> r0 in rows) if (Convert.ToString(r0["key"]) == "cs") csRow = r0;
            double pm = Num(cs, "perMin");
            if (csRow != null) { double ra = Num(csRow, "ratio"); segs.Add(new Seg(pm.ToString("0.0"), num, Fg, ra >= 1 ? 1 : -1, BenchColor(ra), 12, t1)); }
            else if (cs["target"] != null) { double diff = Num(cs, "diff"); segs.Add(new Seg(pm.ToString("0.0"), num, Fg, diff >= 0 ? 1 : -1, diff >= 0 ? Win : Warn, 12, t1)); }
            else segs.Add(new Seg(pm.ToString("0.0") + "/min", num, Fg, 0, Color.Empty, 12, t1 + "/min"));
            if (rows != null)
                foreach (Dictionary<string, object> r0 in rows)
                {
                    string key = Convert.ToString(r0["key"]);
                    if (key == "cs") continue;
                    double ra = Num(r0, "ratio");
                    segs.Add(new Seg(key == "kda" ? "KDA" : "VIS", lbl, Muted, 0, Color.Empty, 5));
                    segs.Add(new Seg(Num(r0, "value").ToString(key == "vision" ? "0.00" : "0.0"), num, Fg, ra >= 1 ? 1 : -1, BenchColor(ra), 12, key == "vision" ? t2 : t1));
                }
            var opp = cs["opp"] as Dictionary<string, object>;
            if (opp != null)
            {
                double od = Num(opp, "diff");
                string on = Convert.ToString(opp["name"]);
                if (on.Length > 9) on = on.Substring(0, 8) + ".";
                segs.Add(new Seg(on, lbl, Muted, 0, Color.Empty, 5));
                // ±0 en gris: ni ganas ni pierdes
                segs.Add(new Seg((od > 0 ? "+" : od < 0 ? "−" : "±") + Math.Abs((int)od), num, od > 0 ? Win : od < 0 ? Loss : Muted, 0, Color.Empty, 12, "±88"));
            }
            string tier = bench != null ? TierShort(Convert.ToString(bench["tier"])) : null;

            float pad = 10 * s, ch = 32 * s, arrowW = 9 * s;
            float x = SegsWidth(g, segs, s, arrowW, fmt);
            // «≈» (estimación) un poco más grande que el rango para que se lea
            float apxW = g.MeasureString("≈", apx, PointF.Empty, fmt).Width + 2 * s;
            float tagW = tier != null ? apxW + g.MeasureString(tier, tag, PointF.Empty, fmt).Width + 10 * s : 0;
            float cw = pad * 2 + x + (tier != null ? tagW + 10 * s : 0);

            // Ancho de referencia fijo (tira completa con los números y el rango más anchos): define el ancla derecha
            var full = new List<Seg> {
                new Seg("CS", lbl, Muted, 0, Color.Empty, 5), new Seg("888", val, Fg, 0, Color.Empty, 7), new Seg(t1, num, Fg, 1, Win, 12),
                new Seg("KDA", lbl, Muted, 0, Color.Empty, 5), new Seg(t1, num, Fg, 1, Win, 12),
                new Seg("VIS", lbl, Muted, 0, Color.Empty, 5), new Seg(t2, num, Fg, 1, Win, 12),
                new Seg("Kassadin.", lbl, Muted, 0, Color.Empty, 5), new Seg("±88", num, Fg, 0, Color.Empty, 12) };
            float refW = pad * 2 + SegsWidth(g, full, s, arrowW, fmt) + apxW + g.MeasureString("PLATINO", tag, PointF.Empty, fmt).Width + 20 * s;

            var r = Place(d, moved, "cs", new SizeF(cw, ch), new PointF(14 * S, 14 * S), w, h, refW, 8 * s);
            Card(g, r, s, GoldLine);
            float cx = r.X + pad, mid = r.Y + ch / 2;
            foreach (var sg in segs)
            {
                var sz = g.MeasureString(sg.Text, sg.Font, PointF.Empty, fmt);
                float slot = SegSlot(g, sg, fmt);
                using (var sh = new SolidBrush(Color.FromArgb(150, 0, 0, 0))) g.DrawString(sg.Text, sg.Font, sh, cx + 1, mid - sz.Height / 2 + 1, fmt);
                using (var b = new SolidBrush(sg.Color)) g.DrawString(sg.Text, sg.Font, b, cx, mid - sz.Height / 2, fmt);
                cx += sz.Width;
                if (sg.Arrow != 0)
                {
                    float ax = cx + 2 * s, ah = 6 * s;
                    var pts = sg.Arrow > 0
                        ? new[] { new PointF(ax, mid + ah / 2), new PointF(ax + arrowW, mid + ah / 2), new PointF(ax + arrowW / 2, mid - ah / 2) }
                        : new[] { new PointF(ax, mid - ah / 2), new PointF(ax + arrowW, mid - ah / 2), new PointF(ax + arrowW / 2, mid + ah / 2) };
                    using (var b = new SolidBrush(sg.ArrowColor)) g.FillPolygon(b, pts);
                    cx += arrowW + 2 * s;
                }
                // Hueco reservado sin usar (número más corto que la plantilla), detrás de la flecha
                cx += slot - sz.Width + sg.Gap * s;
            }
            if (tier != null)
            {
                var tsz = g.MeasureString(tier, tag, PointF.Empty, fmt);
                var tr = new RectangleF(r.Right - pad - tagW, mid - 8 * s, tagW, 16 * s);
                using (var path = Round(tr, 4 * s))
                using (var b = new SolidBrush(Color.FromArgb(40, 210, 167, 91))) g.FillPath(b, path);
                var asz = g.MeasureString("≈", apx, PointF.Empty, fmt);
                float tx = tr.X + (tagW - apxW - tsz.Width) / 2;
                using (var b = new SolidBrush(Gold))
                {
                    g.DrawString("≈", apx, b, tx, mid - asz.Height / 2, fmt);
                    g.DrawString(tier, tag, b, tx + apxW, mid - tsz.Height / 2, fmt);
                }
            }
            return r;
        }
    }

    // Timers de objetivos: avisos 1 minuto antes de que salga cada objetivo (arriba a la derecha por defecto).
    // Siguen mientras el objetivo está vivo y desaparecen cuando alguien lo mata (su próxima aparición queda lejos).
    // Cada aviso tiene una X; cerrado se queda cerrado hasta la siguiente aparición de ese objetivo.
    public static readonly HashSet<string> Dismissed = new HashSet<string>();
    const double PopupLead = 60;

    static RectangleF DrawTimers(Graphics g, Dictionary<string, object> d, double gameTime, float s, int w, int h, Dictionary<string, PointF> moved, bool edit, Dictionary<string, RectangleF> boxes)
    {
        var list = d.ContainsKey("objectives") ? d["objectives"] as ArrayList : null;
        if (list == null || list.Count == 0) return RectangleF.Empty;
        bool popup = !d.ContainsKey("timersPopup") || !(d["timersPopup"] is bool) || (bool)d["timersPopup"];
        var shown = new List<Dictionary<string, object>>();
        foreach (Dictionary<string, object> o in list)
        {
            string kind = Convert.ToString(o["kind"]);
            double left = Num(o, "at") - gameTime;
            if (edit || !popup) { shown.Add(o); continue; }
            if (Dismissed.Contains(kind + "@" + (int)Num(o, "at"))) continue;
            bool inhib = kind.StartsWith("inhib");
            // Inhibidores: solo el último minuto antes de reaparecer. Resto: desde 1 minuto antes y mientras siga vivo.
            if (left <= PopupLead && (!inhib || left > 0)) shown.Add(o);
        }
        if (shown.Count == 0) return RectangleF.Empty;

        float rowH = 28 * s, gap = 4 * s, cw = 186 * s;
        var r = Place(d, moved, "timers", new SizeF(cw, shown.Count * rowH + (shown.Count - 1) * gap), new PointF(w - cw - 14 * S, 64 * S), w, h);
        using (Font name = F(12.5f, false, s), time = F(16, true, s), xf = F(13, false, s))
        {
            float y = r.Y;
            foreach (var o in shown)
            {
                string kind = Convert.ToString(o["kind"]);
                string key = kind + "@" + (int)Num(o, "at");
                double left = Num(o, "at") - gameTime;
                Color dot = ObjColor(kind);
                var card = new RectangleF(r.X, y, cw, rowH);
                Card(g, card, s, left <= 0 ? Color.FromArgb(90, 47, 214, 144) : Color.FromArgb(70, dot.R, dot.G, dot.B));
                string label = Convert.ToString(o["label"]);
                ObjIcon(g, kind, label, new RectangleF(card.X + 7 * s, y + 4 * s, rowH - 8 * s, rowH - 8 * s), dot);
                Txt(g, label, name, Fg, card.X + rowH + 4 * s, y + (rowH - g.MeasureString(label, name).Height) / 2);
                string t = left <= 0 ? "VIVO" : Clock(left);
                Color tc = left <= 0 ? Win : left <= 30 ? Warn : Fg;
                var sz = g.MeasureString(t, time);
                float xw = 18 * s;
                Txt(g, t, time, tc, card.Right - xw - 10 * s - sz.Width, y + (rowH - sz.Height) / 2);
                if (!edit && popup)
                {
                    var xr = new RectangleF(card.Right - xw - 6 * s, y + (rowH - xw) / 2, xw, xw);
                    using (var pen = new Pen(Color.FromArgb(170, 237, 241, 247), Math.Max(1.2f, 1.4f * s)))
                    {
                        float m = 5 * s;
                        g.DrawLine(pen, xr.X + m, xr.Y + m, xr.Right - m, xr.Bottom - m);
                        g.DrawLine(pen, xr.Right - m, xr.Y + m, xr.X + m, xr.Bottom - m);
                    }
                    boxes["x:" + key] = xr;
                }
                y += rowH + gap;
            }
        }
        return r;
    }

    // ---------- Iconos de objetivos (assets/objectives) ----------
    // objectives.png: tira de 80x80 del juego (torre, inhibidor, Barón, dragón, heraldo, larvas). Se tiñen del color del objetivo.
    static Color ObjColor(string kind)
    {
        switch (kind)
        {
            case "dragon": return Warn;                                 // naranja
            case "baron": return Color.FromArgb(255, 176, 120, 255);    // morado
            case "herald": return Color.FromArgb(255, 120, 200, 255);   // celeste
            case "grubs": return Color.FromArgb(255, 214, 128, 255);    // malva (vacío)
            case "inhib-ally": return Ally;
            default: return Loss;
        }
    }

    static Bitmap sprite, elderIcon;
    static bool iconsLoaded;

    static void LoadIcons()
    {
        if (iconsLoaded) return;
        iconsLoaded = true;
        try
        {
            var dir = Path.Combine(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets"), "objectives");
            sprite = new Bitmap(Path.Combine(dir, "objectives.png"));
            elderIcon = new Bitmap(Path.Combine(dir, "elder-100.png"));
        }
        catch { }
    }

    static void ObjIcon(Graphics g, string kind, string label, RectangleF r, Color tint)
    {
        LoadIcons();
        bool elder = kind == "dragon" && label.ToLower().Contains("ancestral") && elderIcon != null;
        if (!elder && sprite == null)
        {
            using (var b = new SolidBrush(tint)) g.FillEllipse(b, r.X + r.Width / 3, r.Y + r.Height / 3, r.Width / 3, r.Height / 3);
            return;
        }
        Image src = elder ? (Image)elderIcon : sprite;
        int frame = kind == "baron" ? 2 : kind == "dragon" ? 3 : kind == "herald" ? 4 : kind == "grubs" ? 5 : kind.StartsWith("inhib") ? 1 : 0;
        var sr = elder ? new Rectangle(0, 0, elderIcon.Width, elderIcon.Height) : new Rectangle(0, frame * 80, 80, 80);
        // Escala de grises y luego el color del objetivo (el icono del ancestral es más oscuro: más ganancia)
        float k = elder ? 2.3f : 1.35f, tr = tint.R / 255f * k, tg = tint.G / 255f * k, tb = tint.B / 255f * k;
        var cm = new ColorMatrix(new float[][] {
            new float[] { 0.3f * tr, 0.3f * tg, 0.3f * tb, 0, 0 },
            new float[] { 0.59f * tr, 0.59f * tg, 0.59f * tb, 0, 0 },
            new float[] { 0.11f * tr, 0.11f * tg, 0.11f * tb, 0, 0 },
            new float[] { 0, 0, 0, 1, 0 },
            new float[] { 0, 0, 0, 0, 1 } });
        using (var ia = new ImageAttributes())
        {
            ia.SetColorMatrix(cm);
            var old = g.InterpolationMode;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(src, Rectangle.Round(r), sr.X, sr.Y, sr.Width, sr.Height, GraphicsUnit.Pixel, ia);
            g.InterpolationMode = old;
        }
    }

    // ---------- Imágenes (iconos de objetos y campeones de Data Dragon), descargadas una vez ----------
    static readonly Dictionary<string, Bitmap> imgCache = new Dictionary<string, Bitmap>();
    static readonly HashSet<string> imgPending = new HashSet<string>();
    public static int ImagesLoaded { get { lock (imgCache) return imgCache.Count; } }

    static Bitmap GetImage(string url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        lock (imgCache)
        {
            Bitmap b;
            if (imgCache.TryGetValue(url, out b)) return b;
            if (imgPending.Contains(url)) return null;
            imgPending.Add(url);
        }
        new Thread(() =>
        {
            Bitmap bmp = null;
            try
            {
                using (var wc = new WebClient())
                using (var ms = new MemoryStream(wc.DownloadData(url))) bmp = new Bitmap(ms);
            }
            catch { }
            lock (imgCache) { imgCache[url] = bmp; imgPending.Remove(url); }
        }) { IsBackground = true }.Start();
        return null;
    }

    static void DrawImageRound(Graphics g, string url, RectangleF r, float rad)
    {
        var img = GetImage(url);
        using (var path = Round(r, rad))
        {
            if (img == null)
            {
                using (var b = new SolidBrush(Color.FromArgb(120, 40, 48, 62))) g.FillPath(b, path);
                return;
            }
            var clip = g.Clip;
            g.SetClip(path, CombineMode.Intersect);
            var old = g.InterpolationMode;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(img, r);
            g.InterpolationMode = old;
            g.Clip = clip;
        }
    }

    static string Fit(Graphics g, string t, Font f, float maxW)
    {
        if (string.IsNullOrEmpty(t) || g.MeasureString(t, f).Width <= maxW) return t ?? "";
        while (t.Length > 1 && g.MeasureString(t + "…", f).Width > maxW) t = t.Substring(0, t.Length - 1);
        return t.TrimEnd() + "…";
    }

    static void DrawX(Graphics g, RectangleF xr, float s)
    {
        using (var pen = new Pen(Color.FromArgb(170, 237, 241, 247), Math.Max(1.2f, 1.4f * s)))
        {
            float m = 5 * s;
            g.DrawLine(pen, xr.X + m, xr.Y + m, xr.Right - m, xr.Bottom - m);
            g.DrawLine(pen, xr.Right - m, xr.Y + m, xr.X + m, xr.Bottom - m);
        }
    }

    // ---------- Vuelve a base: abajo a la derecha, encima del minimapa, por defecto ----------
    static RectangleF DrawBack(Graphics g, Dictionary<string, object> d, float s, int w, int h, Dictionary<string, PointF> moved, bool edit, Dictionary<string, RectangleF> boxes)
    {
        var b = d.ContainsKey("back") ? d["back"] as Dictionary<string, object> : null;
        if (b == null) return RectangleF.Empty;
        string key = "back@" + Convert.ToString(b["key"]);
        if (!edit && Dismissed.Contains(key)) return RectangleF.Empty;
        float cw = 280 * s, ch = 62 * s;
        var r = Place(d, moved, "back", new SizeF(cw, ch), new PointF(w - cw - 14 * S, h - 330 * S - ch), w, h);
        Card(g, r, s, GoldLine);
        DrawImageRound(g, Convert.ToString(b["icon"]), new RectangleF(r.X + 9 * s, r.Y + (ch - 40 * s) / 2, 40 * s, 40 * s), 8 * s);
        float tx = r.X + 57 * s, tw = r.Right - tx - 26 * s;
        using (Font title = F(14, true, s), sub = F(11.5f, false, s))
        {
            Txt(g, Fit(g, Convert.ToString(b["title"]), title, tw), title, Gold, tx, r.Y + 7 * s);
            // "qué comprar · lo que falta": en dos líneas
            var parts = Convert.ToString(b["sub"]).Split(new[] { " · " }, 2, StringSplitOptions.None);
            Txt(g, Fit(g, parts[0], sub, tw), sub, Fg, tx, r.Y + 26 * s);
            if (parts.Length > 1) Txt(g, Fit(g, parts[1], sub, tw), sub, Muted, tx, r.Y + 41 * s);
        }
        if (!edit)
        {
            var xr = new RectangleF(r.Right - 24 * s, r.Y + 6 * s, 18 * s, 18 * s);
            DrawX(g, xr, s);
            boxes["x:" + key] = xr;
        }
        return r;
    }

    // ---------- Pantalla de carga: tu equipo a la izquierda y rivales a la derecha (en los márgenes) ----------
    static readonly Color[] PremadeColors = { Color.FromArgb(255, 255, 182, 72), Color.FromArgb(255, 214, 128, 255), Color.FromArgb(255, 120, 200, 255) };

    static RectangleF DrawLoading(Graphics g, Dictionary<string, object> d, float s, int w, int h, Dictionary<string, PointF> moved, bool edit, Dictionary<string, RectangleF> boxes, string side)
    {
        var L = d.ContainsKey("loading") ? d["loading"] as Dictionary<string, object> : null;
        var list = L != null && L.ContainsKey(side == "ally" ? "allies" : "enemies") ? L[side == "ally" ? "allies" : "enemies"] as ArrayList : null;
        if (list == null || list.Count == 0) return RectangleF.Empty;
        string name = side == "ally" ? "loadAlly" : "loadEnemy";
        string key = "load@" + side;
        if (!edit && Dismissed.Contains(key)) return RectangleF.Empty;
        float cw = 300 * s, rowH = 62 * s, head = 30 * s;
        var size = new SizeF(cw, head + rowH * list.Count + 6 * s);
        var def = side == "ally" ? new PointF(14 * S, (h - size.Height) / 2) : new PointF(w - cw - 14 * S, (h - size.Height) / 2);
        var r = Place(d, moved, name, size, def, w, h);
        Card(g, r, s, side == "ally" ? Color.FromArgb(70, 74, 169, 255) : Color.FromArgb(70, 255, 84, 104));
        using (Font hf = F(11.5f, true, s), nf = F(14.5f, true, s), sf = F(12, false, s), tf = F(11.5f, false, s), bf = F(10, true, s))
        {
            Txt(g, side == "ally" ? "TU EQUIPO" : "RIVALES", hf, side == "ally" ? Ally : Loss, r.X + 12 * s, r.Y + 9 * s);
            if (!edit)
            {
                var xr = new RectangleF(r.Right - 24 * s, r.Y + 6 * s, 18 * s, 18 * s);
                DrawX(g, xr, s);
                boxes["x:" + key] = xr;
            }
            float y = r.Y + head;
            foreach (Dictionary<string, object> p in list)
            {
                bool me = p["me"] is bool && (bool)p["me"];
                if (me)
                    using (var path = Round(new RectangleF(r.X + 4 * s, y, cw - 8 * s, rowH - 4 * s), 8 * s))
                    using (var bb = new SolidBrush(Color.FromArgb(40, 210, 167, 91))) g.FillPath(bb, path);
                DrawImageRound(g, Convert.ToString(p["icon"]), new RectangleF(r.X + 10 * s, y + 6 * s, 38 * s, 38 * s), 8 * s);
                float tx = r.X + 56 * s, right = r.Right - 10 * s;
                // Línea 1: campeón (+ premade) y rango
                string rank = Convert.ToString(p["rank"]);
                var rs = g.MeasureString(rank, sf);
                Txt(g, rank, sf, Muted, right - rs.Width, y + 5 * s);
                string champ = me ? "Tú · " + p["champ"] : Convert.ToString(p["champ"]);
                champ = Fit(g, champ, nf, right - rs.Width - tx - 50 * s);
                Txt(g, champ, nf, me ? Gold : Fg, tx, y + 2 * s);
                int premade = Convert.ToInt32(p["premade"]);
                if (premade > 0)
                {
                    var cwid = g.MeasureString(champ, nf).Width;
                    var pc = PremadeColors[(premade - 1) % PremadeColors.Length];
                    var br = new RectangleF(tx + cwid + 4 * s, y + 5 * s, 48 * s, 16 * s);
                    using (var path = Round(br, 4 * s))
                    using (var bb = new SolidBrush(Color.FromArgb(60, pc.R, pc.G, pc.B))) g.FillPath(bb, path);
                    Txt(g, "Premade", bf, pc, br.X + 4 * s, br.Y + 1 * s);
                }
                // Línea 2: experiencia con el campeón y winrate en ranked
                bool loading = p["loading"] is bool && (bool)p["loading"];
                string l2 = loading ? "Cargando…" : Convert.ToString(p["champLine"]) + (p["wr"] != null ? " · " + p["wr"] + "% en ranked" : "");
                Txt(g, Fit(g, l2, tf, right - tx), tf, Muted, tx, y + 22 * s);
                // Línea 3: etiquetas
                var tags = p["tags"] as ArrayList;
                if (tags != null && tags.Count > 0)
                {
                    float x = tx;
                    foreach (Dictionary<string, object> t in tags)
                    {
                        string tone = Convert.ToString(t["tone"]);
                        Color c = tone == "bad" ? Loss : tone == "good" ? Win : Ally;
                        string txt = Fit(g, Convert.ToString(t["text"]), tf, right - x);
                        if (txt.Length < 3) break;
                        Txt(g, txt, tf, c, x, y + 40 * s);
                        x += g.MeasureString(txt, tf).Width + 8 * s;
                        if (x > right - 30 * s) break;
                    }
                }
                y += rowH;
            }
        }
        return r;
    }

    // Habilidad a subir: centrada, encima de la barra de habilidades, por defecto
    static RectangleF DrawSkill(Graphics g, Dictionary<string, object> d, float s, int w, int h, Dictionary<string, PointF> moved)
    {
        var key = d.ContainsKey("skill") ? d["skill"] as string : null;
        if (string.IsNullOrEmpty(key)) return RectangleF.Empty;
        using (Font big = F(17, true, s), mid = F(14, true, s))
        {
            string label = "Sube la " + key;
            var lsz = g.MeasureString(label, mid);
            float ch = 32 * s, cw = 5 * s + 22 * s + 8 * s + lsz.Width + 6 * s;
            var r = Place(d, moved, "skill", new SizeF(cw, ch), new PointF((w - cw) / 2, h - 262 * S), w, h);
            Card(g, r, s, WinLine);
            var k = new RectangleF(r.X + 5 * s, r.Y + 5 * s, 22 * s, 22 * s);
            using (var path = Round(k, 6 * s))
            using (var b = new SolidBrush(Color.FromArgb(220, 47, 214, 144))) g.FillPath(b, path);
            var sz = g.MeasureString(key, big);
            Txt(g, key, big, Color.FromArgb(255, 3, 20, 12), k.X + (k.Width - sz.Width) / 2, k.Y + (k.Height - sz.Height) / 2);
            Txt(g, label, mid, Fg, k.Right + 8 * s, r.Y + (ch - lsz.Height) / 2);
            return r;
        }
    }
}
