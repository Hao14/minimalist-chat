using System.Collections.Concurrent;
using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace MinimalistAIAnalysis;

internal static class ApplePalette
{
    // Porcelain neutrals.
    internal static readonly Color Ink = Color.FromArgb(29, 29, 31);
    internal static readonly Color Secondary = Color.FromArgb(91, 91, 96);
    internal static readonly Color Tertiary = Color.FromArgb(126, 126, 132);
    internal static readonly Color Canvas = Color.FromArgb(244, 244, 246);
    internal static readonly Color Surface = Color.White;
    internal static readonly Color SurfaceSunken = Color.FromArgb(240, 240, 243);
    internal static readonly Color SurfaceHover = Color.FromArgb(248, 248, 250);
    internal static readonly Color SurfacePressed = Color.FromArgb(235, 235, 239);
    internal static readonly Color Elevated = Color.FromArgb(253, 253, 255);
    internal static readonly Color Hairline = Color.FromArgb(228, 228, 233);
    internal static readonly Color HairlineStrong = Color.FromArgb(210, 210, 217);
    internal static readonly Color ShadowAmbient = Color.FromArgb(18, 32, 52, 74);
    internal static readonly Color ShadowKey = Color.FromArgb(22, 25, 39, 61);

    // Porcelain accent and semantic colors.
    internal static readonly Color AccentFill = Color.FromArgb(0, 122, 255);
    internal static readonly Color AccentText = Color.FromArgb(0, 102, 204);
    internal static readonly Color AccentTint = Color.FromArgb(236, 245, 255);
    internal static readonly Color GreenText = Color.FromArgb(30, 128, 56);
    internal static readonly Color GreenDot = Color.FromArgb(52, 199, 89);
    internal static readonly Color GreenTint = Color.FromArgb(237, 249, 241);
    internal static readonly Color OrangeText = Color.FromArgb(158, 92, 0);
    internal static readonly Color OrangeDot = Color.FromArgb(255, 159, 10);
    internal static readonly Color WarningTint = Color.FromArgb(255, 246, 229);
    internal static readonly Color WarningLine = Color.FromArgb(240, 223, 194);
    internal static readonly Color RedText = Color.FromArgb(181, 45, 52);
    internal static readonly Color RedDot = Color.FromArgb(255, 69, 58);
    internal static readonly Color RedTint = Color.FromArgb(255, 239, 240);

    // Console colors remain purposefully separate from the light Porcelain system.
    internal static readonly Color Console = Color.FromArgb(23, 24, 28);
    internal static readonly Color ConsoleRaised = Color.FromArgb(31, 32, 38);
    internal static readonly Color ConsoleInput = Color.FromArgb(36, 37, 44);
    internal static readonly Color ConsoleLine = Color.FromArgb(51, 52, 59);
    internal static readonly Color ConsoleInk = Color.FromArgb(237, 237, 242);
    internal static readonly Color ConsoleDim = Color.FromArgb(142, 142, 151);
    internal static readonly Color ConsoleAccent = Color.FromArgb(89, 168, 255);
    internal static readonly Color ConsoleGreen = Color.FromArgb(78, 214, 117);
    internal static readonly Color ConsoleRed = Color.FromArgb(255, 122, 128);

    // Compatibility aliases used throughout the existing form and chart controls.
    internal static readonly Color Line = Hairline;
    internal static readonly Color StrongLine = HairlineStrong;
    internal static readonly Color Blue = AccentText;
    internal static readonly Color BlueFill = AccentFill;
    internal static readonly Color BlueTint = AccentTint;
    internal static readonly Color Green = GreenText;
    internal static readonly Color Orange = OrangeText;
    internal static readonly Color Red = RedText;
}

internal static class AppleTypography
{
    private readonly record struct FontKey(string Family, float Size, FontStyle Style);

    private static readonly HashSet<string> InstalledFamilies = new(
        FontFamily.Families.Select(family => family.Name),
        StringComparer.OrdinalIgnoreCase);

    private static readonly ConcurrentDictionary<FontKey, Font> FontCache = new();

    internal static readonly string DisplayFamily = ResolveFamily(
        "Segoe UI Variable Display",
        "Segoe UI Variable",
        "Segoe UI");

    internal static readonly string TextFamily = ResolveFamily(
        "Segoe UI Variable Text",
        "Segoe UI Variable",
        "Segoe UI");

    internal static readonly string MonoFamily = ResolveFamily(
        "Cascadia Mono",
        "Cascadia Code",
        "Consolas");

    internal static Font LargeTitle => Get(DisplayFamily, 22f, FontStyle.Bold);
    internal static Font LargeTitleShort => Get(DisplayFamily, 20f, FontStyle.Bold);
    internal static Font Title => Get(TextFamily, 14f, FontStyle.Bold);
    internal static Font Metric => Get(DisplayFamily, 26f, FontStyle.Regular);
    internal static Font MetricCompact => Get(DisplayFamily, 24f, FontStyle.Regular);
    internal static Font Body => Get(TextFamily, 9.75f, FontStyle.Regular);
    internal static Font BodySemibold => Get(TextFamily, 9.75f, FontStyle.Bold);
    internal static Font Footnote => Get(TextFamily, 8.75f, FontStyle.Regular);
    internal static Font FootnoteSemibold => Get(TextFamily, 8.75f, FontStyle.Bold);
    internal static Font Mono => Get(MonoFamily, 9.75f, FontStyle.Regular);
    internal static Font MonoCompact => Get(MonoFamily, 9f, FontStyle.Regular);

    internal static Font LargeTitleFor(bool shortWindow) => shortWindow ? LargeTitleShort : LargeTitle;
    internal static Font MetricFor(bool compact) => compact ? MetricCompact : Metric;
    internal static Font MonoFor(bool compact) => compact ? MonoCompact : Mono;

    internal static Font Get(float size, FontStyle style = FontStyle.Regular, bool monospace = false) =>
        Get(monospace ? MonoFamily : TextFamily, size, style);

    private static Font Get(string family, float size, FontStyle style) =>
        FontCache.GetOrAdd(new FontKey(family, size, style), static key =>
        {
            try
            {
                return new Font(key.Family, key.Size, key.Style, GraphicsUnit.Point);
            }
            catch (ArgumentException)
            {
                return new Font(SystemFonts.MessageBoxFont!.FontFamily, key.Size, key.Style, GraphicsUnit.Point);
            }
        });

    private static string ResolveFamily(params string[] candidates) =>
        candidates.FirstOrDefault(InstalledFamilies.Contains) ?? SystemFonts.MessageBoxFont!.FontFamily.Name;
}

internal readonly record struct AppleMetricScale(
    float ScaleFactor,
    int InputRadius,
    int PillRadius,
    int CardRadius,
    int HeroRadius,
    int DockRadius,
    float HairlineWidth,
    float FocusWidth,
    float ShadowInset);

internal static class AppleMetrics
{
    internal const int InputRadius = 8;
    internal const int PillRadius = 10;
    internal const int CardRadius = 12;
    internal const int HeroRadius = 16;
    internal const int DockRadius = 18;

    private static readonly ConcurrentDictionary<int, AppleMetricScale> ScaleCache = new();

    internal static AppleMetricScale For(Control control) => ForDpi(control.DeviceDpi);

    internal static AppleMetricScale ForDpi(int dpi)
    {
        dpi = dpi > 0 ? dpi : 96;
        return ScaleCache.GetOrAdd(dpi, static value =>
        {
            var scale = value / 96f;
            return new AppleMetricScale(
                scale,
                Math.Max(1, (int)Math.Round(InputRadius * scale)),
                Math.Max(1, (int)Math.Round(PillRadius * scale)),
                Math.Max(1, (int)Math.Round(CardRadius * scale)),
                Math.Max(1, (int)Math.Round(HeroRadius * scale)),
                Math.Max(1, (int)Math.Round(DockRadius * scale)),
                Math.Max(1f, scale),
                Math.Max(1.5f, 1.75f * scale),
                Math.Max(2f, 2.5f * scale));
        });
    }

    internal static int Scale(Control control, int logicalPixels) =>
        Math.Max(0, (int)Math.Round(logicalPixels * For(control).ScaleFactor));

    internal static float Scale(Control control, float logicalPixels) =>
        Math.Max(0f, logicalPixels * For(control).ScaleFactor);
}

internal static class ApplePainter
{
    internal static void Configure(Graphics graphics)
    {
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.CompositingQuality = CompositingQuality.GammaCorrected;
    }

    internal static void PaintParentBackdrop(
        Control control,
        PaintEventArgs e,
        Action<Control, PaintEventArgs> invokePaintBackground)
    {
        _ = invokePaintBackground;
        var fallback = SystemInformation.HighContrast
            ? SystemColors.Control
            : ResolveBackdrop(control);
        e.Graphics.Clear(fallback);
    }

    internal static Color ResolveBackdrop(Control control)
    {
        var parentColor = control.Parent?.BackColor ?? ApplePalette.Canvas;
        return parentColor == Color.Transparent || parentColor.A == 0
            ? ApplePalette.Canvas
            : parentColor;
    }

    internal static Color InteractiveFill(
        Color fill,
        Color backdrop,
        bool enabled,
        bool hovered,
        bool pressed)
    {
        if (!enabled) return Blend(backdrop, fill, .42f);
        if (pressed) return Blend(fill, Color.Black, IsDark(fill) ? .14f : .055f);
        if (hovered)
        {
            if (IsDark(fill)) return Blend(fill, Color.White, .075f);
            return Blend(fill, ApplePalette.SurfacePressed, fill.GetBrightness() > .88f ? .34f : .16f);
        }
        return fill;
    }

    internal static Color DisabledColor(Color color, Color backdrop) => Blend(backdrop, color, .46f);

    internal static Color Blend(Color from, Color to, float amount)
    {
        amount = Math.Clamp(amount, 0f, 1f);
        return Color.FromArgb(
            (int)Math.Round(from.A + ((to.A - from.A) * amount)),
            (int)Math.Round(from.R + ((to.R - from.R) * amount)),
            (int)Math.Round(from.G + ((to.G - from.G) * amount)),
            (int)Math.Round(from.B + ((to.B - from.B) * amount)));
    }

    internal static bool IsDark(Color color) =>
        ((color.R * 299) + (color.G * 587) + (color.B * 114)) / 1000 < 126;

    internal static bool CanDrawShadow(Control control, Color fill, int logicalRadius)
    {
        return !SystemInformation.HighContrast &&
               control.Enabled &&
               !IsDark(fill) &&
               logicalRadius >= AppleMetrics.CardRadius &&
               control.Width >= AppleMetrics.Scale(control, 80) &&
               control.Height >= AppleMetrics.Scale(control, 42);
    }

    internal static void DrawSoftShadow(Graphics graphics, RectangleF bounds, float radius, float scale)
    {
        if (bounds.Width <= 1 || bounds.Height <= 1) return;

        // Three translucent silhouettes read as a diffuse elevation without a timer,
        // bitmap cache, or expensive blur pass.
        var passes = new (float Inflate, float OffsetY, Color Color)[]
        {
            (2.2f * scale, 1.4f * scale, ApplePalette.ShadowAmbient),
            (1.35f * scale, 1.0f * scale, ApplePalette.ShadowKey),
            (.7f * scale, .55f * scale, Color.FromArgb(16, 25, 39, 61)),
        };

        foreach (var pass in passes)
        {
            var shadowBounds = RectangleF.Inflate(bounds, pass.Inflate, pass.Inflate);
            shadowBounds.Y += pass.OffsetY;
            using var path = AppleSurface.RoundedPath(shadowBounds, radius + pass.Inflate);
            using var brush = new SolidBrush(pass.Color);
            graphics.FillPath(brush, path);
        }
    }

    internal static void DrawFocusRing(
        Graphics graphics,
        RectangleF bounds,
        float radius,
        float width,
        Color fill)
    {
        var inset = Math.Max(2f, width * 1.15f);
        if (SystemInformation.HighContrast)
        {
            ControlPaint.DrawFocusRectangle(
                graphics,
                Rectangle.Round(RectangleF.Inflate(bounds, -inset, -inset)),
                SystemColors.HighlightText,
                SystemColors.Highlight);
            return;
        }

        var ringColor = IsDark(fill) ? Color.FromArgb(230, Color.White) : ApplePalette.AccentFill;
        using var path = AppleSurface.RoundedPath(RectangleF.Inflate(bounds, -inset, -inset), Math.Max(inset, radius - inset));
        using var halo = new Pen(Color.FromArgb(58, ringColor), width + inset);
        using var pen = new Pen(Color.FromArgb(220, ringColor), width);
        graphics.DrawPath(halo, path);
        graphics.DrawPath(pen, path);
    }
}

internal static class AppleWindowChrome
{
    private const int UseImmersiveDarkMode = 20;
    private const int UseImmersiveDarkModeLegacy = 19;
    private const int WindowCornerPreference = 33;
    private const int BorderColor = 34;
    private const int CaptionColor = 35;
    private const int TextColor = 36;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int valueSize);

    internal static void ApplyLightTheme(IntPtr handle)
    {
        if (!OperatingSystem.IsWindows() || handle == IntPtr.Zero || SystemInformation.HighContrast) return;
        try
        {
            var disabled = 0;
            if (DwmSetWindowAttribute(handle, UseImmersiveDarkMode, ref disabled, sizeof(int)) != 0)
                DwmSetWindowAttribute(handle, UseImmersiveDarkModeLegacy, ref disabled, sizeof(int));
            var rounded = 2;
            DwmSetWindowAttribute(handle, WindowCornerPreference, ref rounded, sizeof(int));
            var white = ColorRef(Color.White);
            var ink = ColorRef(ApplePalette.Ink);
            var border = ColorRef(ApplePalette.Line);
            DwmSetWindowAttribute(handle, CaptionColor, ref white, sizeof(int));
            DwmSetWindowAttribute(handle, TextColor, ref ink, sizeof(int));
            DwmSetWindowAttribute(handle, BorderColor, ref border, sizeof(int));
        }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
    }

    private static int ColorRef(Color color) => color.R | (color.G << 8) | (color.B << 16);
}

internal sealed class AppleSurface : Panel
{
    private int _cornerRadius = 20;
    private Color _strokeColor = ApplePalette.Line;
    private bool _drawStroke = true;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public int CornerRadius
    {
        get => _cornerRadius;
        set
        {
            if (_cornerRadius == value) return;
            _cornerRadius = Math.Max(0, value);
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color StrokeColor
    {
        get => _strokeColor;
        set
        {
            if (_strokeColor == value) return;
            _strokeColor = value;
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public bool DrawStroke
    {
        get => _drawStroke;
        set
        {
            if (_drawStroke == value) return;
            _drawStroke = value;
            Invalidate();
        }
    }

    public AppleSurface()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true);
        DoubleBuffered = true;
        BackColor = ApplePalette.Surface;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);
        ApplePainter.PaintParentBackdrop(this, e, InvokePaintBackground);

        var highContrast = SystemInformation.HighContrast;
        var fill = highContrast ? SystemColors.Window : BackColor;
        var metrics = AppleMetrics.For(this);
        var radius = AppleMetrics.Scale(this, CornerRadius);
        var hasShadow = DrawStroke && ApplePainter.CanDrawShadow(this, fill, CornerRadius);
        var inset = hasShadow ? metrics.ShadowInset : metrics.HairlineWidth / 2f;
        var bounds = new RectangleF(
            inset,
            hasShadow ? Math.Max(metrics.HairlineWidth, inset - metrics.ScaleFactor) : inset,
            Math.Max(1f, Width - (inset * 2f)),
            Math.Max(1f, Height - (inset * 2f)));

        if (hasShadow)
            ApplePainter.DrawSoftShadow(e.Graphics, bounds, radius, metrics.ScaleFactor);

        using var path = RoundedPath(bounds, radius);
        using var brush = new SolidBrush(fill);
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);
        if (DrawStroke && Width > 2 && Height > 2)
        {
            var highContrast = SystemInformation.HighContrast;
            var fill = highContrast ? SystemColors.Window : BackColor;
            var metrics = AppleMetrics.For(this);
            var radius = AppleMetrics.Scale(this, CornerRadius);
            var hasShadow = ApplePainter.CanDrawShadow(this, fill, CornerRadius);
            var inset = hasShadow ? metrics.ShadowInset : metrics.HairlineWidth / 2f;
            var bounds = new RectangleF(
                inset,
                hasShadow ? Math.Max(metrics.HairlineWidth, inset - metrics.ScaleFactor) : inset,
                Math.Max(1f, Width - (inset * 2f)),
                Math.Max(1f, Height - (inset * 2f)));
            using var path = RoundedPath(bounds, radius);
            using var pen = new Pen(highContrast ? SystemColors.ControlDark : StrokeColor, metrics.HairlineWidth);
            e.Graphics.DrawPath(pen, path);
        }
        base.OnPaint(e);
    }

    internal static GraphicsPath RoundedPath(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        if (bounds.Width <= 0 || bounds.Height <= 0) return path;

        var diameter = Math.Min(Math.Max(0, radius) * 2f, Math.Min(bounds.Width, bounds.Height));
        if (diameter <= .5f)
        {
            path.AddRectangle(bounds);
            path.CloseFigure();
            return path;
        }

        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal class AppleButton : Button
{
    private bool _hovered;
    private bool _pressed;
    private int _cornerRadius = 11;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public int CornerRadius
    {
        get => _cornerRadius;
        set
        {
            if (_cornerRadius == value) return;
            _cornerRadius = Math.Max(0, value);
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public bool ForceTextPaint { get; set; }

    public AppleButton()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 1;
        FlatAppearance.BorderColor = ApplePalette.Line;
        FlatAppearance.MouseOverBackColor = ApplePalette.SurfaceHover;
        FlatAppearance.MouseDownBackColor = ApplePalette.SurfacePressed;
        BackColor = ApplePalette.Surface;
        ForeColor = ApplePalette.Ink;
        UseVisualStyleBackColor = false;
        TextAlign = ContentAlignment.MiddleCenter;
        UseCompatibleTextRendering = true;
        Cursor = Cursors.Hand;
    }

    protected override void OnPaintBackground(PaintEventArgs pevent)
    {
        ApplePainter.Configure(pevent.Graphics);
        ApplePainter.PaintParentBackdrop(this, pevent, InvokePaintBackground);
    }

    protected override void OnPaint(PaintEventArgs pevent)
    {
        ApplePainter.Configure(pevent.Graphics);

        var highContrast = SystemInformation.HighContrast;
        var backdrop = highContrast ? SystemColors.Control : ApplePainter.ResolveBackdrop(this);
        pevent.Graphics.Clear(backdrop);
        var baseFill = highContrast
            ? Enabled ? SystemColors.Control : SystemColors.ControlLight
            : BackColor;
        var fill = highContrast
            ? _pressed ? SystemColors.Highlight : _hovered ? SystemColors.ControlLight : baseFill
            : ApplePainter.InteractiveFill(baseFill, backdrop, Enabled, _hovered, _pressed);
        var metrics = AppleMetrics.For(this);
        var radius = AppleMetrics.Scale(this, CornerRadius);
        var hasShadow = FlatAppearance.BorderSize > 0 && ApplePainter.CanDrawShadow(this, fill, CornerRadius);
        var inset = hasShadow ? metrics.ShadowInset : Math.Max(metrics.HairlineWidth / 2f, .5f);
        var bounds = new RectangleF(
            inset,
            hasShadow ? Math.Max(metrics.HairlineWidth, inset - metrics.ScaleFactor) : inset,
            Math.Max(1f, Width - (inset * 2f)),
            Math.Max(1f, Height - (inset * 2f)));

        if (hasShadow)
            ApplePainter.DrawSoftShadow(pevent.Graphics, bounds, radius, metrics.ScaleFactor);

        using (var path = AppleSurface.RoundedPath(bounds, radius))
        using (var brush = new SolidBrush(fill))
            pevent.Graphics.FillPath(brush, path);

        if (FlatAppearance.BorderSize > 0 && Width > 2 && Height > 2)
        {
            var border = highContrast
                ? SystemColors.ControlDark
                : Enabled
                    ? FlatAppearance.BorderColor
                    : ApplePainter.DisabledColor(FlatAppearance.BorderColor, backdrop);
            using var path = AppleSurface.RoundedPath(bounds, radius);
            using var pen = new Pen(border, Math.Max(metrics.HairlineWidth, FlatAppearance.BorderSize * metrics.ScaleFactor));
            pevent.Graphics.DrawPath(pen, path);
        }

        if (!string.IsNullOrEmpty(Text))
        {
            var textColor = highContrast
                ? Enabled ? (_pressed ? SystemColors.HighlightText : SystemColors.ControlText) : SystemColors.GrayText
                : Enabled ? ForeColor : ApplePalette.Tertiary;
            TextRenderer.DrawText(
                pevent.Graphics,
                Text,
                Font,
                ClientRectangle,
                textColor,
                TextFormatFlags.HorizontalCenter |
                TextFormatFlags.VerticalCenter |
                TextFormatFlags.SingleLine |
                TextFormatFlags.EndEllipsis |
                TextFormatFlags.NoPadding);
        }

        if (Focused && ShowFocusCues)
            ApplePainter.DrawFocusRing(pevent.Graphics, bounds, radius, metrics.FocusWidth, fill);
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        _hovered = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hovered = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs mevent)
    {
        base.OnMouseDown(mevent);
        if (mevent.Button == MouseButtons.Left) _pressed = true;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs mevent)
    {
        base.OnMouseUp(mevent);
        _pressed = false;
        Invalidate();
    }

    protected override void OnEnabledChanged(EventArgs e)
    {
        base.OnEnabledChanged(e);
        _pressed = false;
        Invalidate();
    }
}

internal sealed class AppleActionButton : Control
{
    private bool _hovered;
    private bool _pressed;
    private string _caption = string.Empty;
    private int _cornerRadius = 11;
    private Color _borderColor = ApplePalette.Line;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public int CornerRadius
    {
        get => _cornerRadius;
        set
        {
            if (_cornerRadius == value) return;
            _cornerRadius = Math.Max(0, value);
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public Color BorderColor
    {
        get => _borderColor;
        set
        {
            if (_borderColor == value) return;
            _borderColor = value;
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public string Caption
    {
        get => _caption;
        set
        {
            _caption = value ?? string.Empty;
            Text = _caption;
            AccessibleName = _caption;
            Invalidate();
        }
    }

    public AppleActionButton()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw |
            ControlStyles.SupportsTransparentBackColor |
            ControlStyles.Selectable,
            true);
        DoubleBuffered = true;
        BackColor = ApplePalette.Surface;
        ForeColor = ApplePalette.Ink;
        Cursor = Cursors.Hand;
        TabStop = true;
        AccessibleRole = AccessibleRole.PushButton;
    }

    protected override AccessibleObject CreateAccessibilityInstance() => new ActionButtonAccessibleObject(this);

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);
        ApplePainter.PaintParentBackdrop(this, e, InvokePaintBackground);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);

        var highContrast = SystemInformation.HighContrast;
        var backdrop = highContrast ? SystemColors.Control : ApplePainter.ResolveBackdrop(this);
        var baseFill = highContrast
            ? Enabled ? SystemColors.Control : SystemColors.ControlLight
            : BackColor;
        var fill = highContrast
            ? _pressed ? SystemColors.Highlight : _hovered ? SystemColors.ControlLight : baseFill
            : ApplePainter.InteractiveFill(baseFill, backdrop, Enabled, _hovered, _pressed);
        var metrics = AppleMetrics.For(this);
        var radius = AppleMetrics.Scale(this, CornerRadius);
        var hasShadow = ApplePainter.CanDrawShadow(this, fill, CornerRadius);
        var inset = hasShadow ? metrics.ShadowInset : Math.Max(metrics.HairlineWidth / 2f, .5f);
        var bounds = new RectangleF(
            inset,
            hasShadow ? Math.Max(metrics.HairlineWidth, inset - metrics.ScaleFactor) : inset,
            Math.Max(1f, Width - (inset * 2f)),
            Math.Max(1f, Height - (inset * 2f)));

        if (hasShadow)
            ApplePainter.DrawSoftShadow(e.Graphics, bounds, radius, metrics.ScaleFactor);

        using (var path = AppleSurface.RoundedPath(bounds, radius))
        using (var brush = new SolidBrush(fill))
            e.Graphics.FillPath(brush, path);

        var border = highContrast
            ? SystemColors.ControlDark
            : Enabled
                ? BorderColor
                : ApplePainter.DisabledColor(BorderColor, backdrop);
        using (var path = AppleSurface.RoundedPath(bounds, radius))
        using (var pen = new Pen(border, metrics.HairlineWidth))
            e.Graphics.DrawPath(pen, path);

        var textColor = highContrast
            ? Enabled ? (_pressed ? SystemColors.HighlightText : SystemColors.ControlText) : SystemColors.GrayText
            : Enabled ? ForeColor : ApplePalette.Tertiary;
        TextRenderer.DrawText(
            e.Graphics,
            _caption,
            Font,
            ClientRectangle,
            textColor,
            TextFormatFlags.HorizontalCenter |
            TextFormatFlags.VerticalCenter |
            TextFormatFlags.SingleLine |
            TextFormatFlags.EndEllipsis |
            TextFormatFlags.NoPadding);

        if (Focused && ShowFocusCues)
        {
            var focusFill = fill.A == 0
                ? highContrast ? SystemColors.Control : ApplePainter.ResolveBackdrop(this)
                : fill;
            ApplePainter.DrawFocusRing(e.Graphics, bounds, radius, metrics.FocusWidth, focusFill);
        }
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        _hovered = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hovered = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left)
        {
            _pressed = true;
            Focus();
        }
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnEnabledChanged(EventArgs e)
    {
        base.OnEnabledChanged(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode is Keys.Enter or Keys.Space)
        {
            OnClick(EventArgs.Empty);
            e.Handled = true;
        }
    }

    private sealed class ActionButtonAccessibleObject(AppleActionButton owner) : ControlAccessibleObject(owner)
    {
        public override string? DefaultAction => "Press";

        public override AccessibleRole Role => AccessibleRole.PushButton;

        public override AccessibleStates State
        {
            get
            {
                var state = base.State | AccessibleStates.Focusable;
                if (!owner.Enabled) state |= AccessibleStates.Unavailable;
                if (owner._pressed) state |= AccessibleStates.Pressed;
                return state;
            }
        }

        public override void DoDefaultAction()
        {
            if (owner.Enabled) owner.OnClick(EventArgs.Empty);
        }
    }
}

internal enum AppleNavIcon
{
    Overview,
    Users,
    Ai,
    Health,
    Console,
}

internal sealed class AppleNavButton : Control
{
    private bool _hovered;
    private bool _pressed;
    private bool _selected;
    private AppleNavIcon _icon;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public AppleNavIcon Icon
    {
        get => _icon;
        set
        {
            if (_icon == value) return;
            _icon = value;
            Invalidate();
        }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public bool Selected
    {
        get => _selected;
        set
        {
            if (_selected == value) return;
            _selected = value;
            Invalidate();
            AccessibilityNotifyClients(AccessibleEvents.StateChange, -1);
            if (value) AccessibilityNotifyClients(AccessibleEvents.Selection, -1);
        }
    }

    public AppleNavButton()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw |
            ControlStyles.SupportsTransparentBackColor |
            ControlStyles.Selectable,
            true);
        DoubleBuffered = true;
        Cursor = Cursors.Hand;
        TabStop = true;
        AccessibleRole = AccessibleRole.PageTab;
        BackColor = Color.Transparent;
        Font = AppleTypography.FootnoteSemibold;
    }

    protected override AccessibleObject CreateAccessibilityInstance() => new NavButtonAccessibleObject(this);

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);
        ApplePainter.PaintParentBackdrop(this, e, InvokePaintBackground);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        ApplePainter.Configure(e.Graphics);
        var highContrast = SystemInformation.HighContrast;
        var metrics = AppleMetrics.For(this);
        var scale = metrics.ScaleFactor;
        var inset = Math.Max(2f, 3f * scale);
        var bounds = new RectangleF(
            inset,
            inset,
            Math.Max(1f, Width - (inset * 2f)),
            Math.Max(1f, Height - (inset * 2f)));
        var radius = AppleMetrics.Scale(this, AppleMetrics.PillRadius);

        Color fill;
        Color color;
        if (highContrast)
        {
            fill = Selected || _pressed
                ? SystemColors.Highlight
                : _hovered ? SystemColors.ControlLight : Color.Transparent;
            color = !Enabled
                ? SystemColors.GrayText
                : Selected || _pressed ? SystemColors.HighlightText : SystemColors.ControlText;
        }
        else
        {
            fill = Selected
                ? ApplePalette.AccentTint
                : _pressed
                    ? ApplePalette.SurfacePressed
                    : _hovered
                        ? ApplePalette.SurfaceHover
                        : Color.Transparent;
            color = !Enabled
                ? ApplePalette.Tertiary
                : Selected ? ApplePalette.AccentText : ApplePalette.Secondary;
        }

        if (fill != Color.Transparent)
        {
            using var path = AppleSurface.RoundedPath(bounds, radius);
            using var brush = new SolidBrush(fill);
            e.Graphics.FillPath(brush, path);
            if (Selected && !highContrast)
            {
                using var edge = new Pen(Color.FromArgb(72, ApplePalette.AccentFill), metrics.HairlineWidth);
                e.Graphics.DrawPath(edge, path);
            }
        }

        var iconSize = Math.Min(AppleMetrics.Scale(this, 20f), Math.Max(10f, Height - AppleMetrics.Scale(this, 16f)));
        var gap = AppleMetrics.Scale(this, 8f);
        var textSize = TextRenderer.MeasureText(
            Text,
            Font,
            Size.Empty,
            TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        var totalWidth = iconSize + gap + textSize.Width;
        var minimumLeft = AppleMetrics.Scale(this, 7f);
        var left = Math.Max(minimumLeft, (Width - totalWidth) / 2f);
        var iconBounds = new RectangleF(left, (Height - iconSize) / 2f, iconSize, iconSize);
        DrawIcon(e.Graphics, iconBounds, color, scale);
        var textLeft = left + iconSize + gap;
        var textBounds = new Rectangle(
            (int)Math.Round(textLeft),
            0,
            Math.Max(1, Width - (int)Math.Round(textLeft) - AppleMetrics.Scale(this, 4)),
            Height);
        TextRenderer.DrawText(
            e.Graphics,
            Text,
            Font,
            textBounds,
            color,
            TextFormatFlags.Left |
            TextFormatFlags.VerticalCenter |
            TextFormatFlags.SingleLine |
            TextFormatFlags.EndEllipsis |
            TextFormatFlags.NoPadding);

        if (Focused && ShowFocusCues)
        {
            var focusFill = fill.A == 0
                ? highContrast ? SystemColors.Control : ApplePainter.ResolveBackdrop(this)
                : fill;
            ApplePainter.DrawFocusRing(e.Graphics, bounds, radius, metrics.FocusWidth, focusFill);
        }
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        _hovered = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hovered = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left)
        {
            _pressed = true;
            Focus();
        }
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnEnabledChanged(EventArgs e)
    {
        base.OnEnabledChanged(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode is Keys.Enter or Keys.Space)
        {
            OnClick(EventArgs.Empty);
            e.Handled = true;
        }
    }

    private sealed class NavButtonAccessibleObject(AppleNavButton owner) : ControlAccessibleObject(owner)
    {
        public override string? DefaultAction => "Select";

        public override AccessibleRole Role => AccessibleRole.PageTab;

        public override AccessibleStates State
        {
            get
            {
                var state = base.State | AccessibleStates.Focusable | AccessibleStates.Selectable;
                if (!owner.Enabled) state |= AccessibleStates.Unavailable;
                if (owner.Selected) state |= AccessibleStates.Selected;
                if (owner._pressed) state |= AccessibleStates.Pressed;
                return state;
            }
        }

        public override void DoDefaultAction()
        {
            if (owner.Enabled) owner.OnClick(EventArgs.Empty);
        }
    }

    private void DrawIcon(Graphics graphics, RectangleF bounds, Color color, float dpiScale)
    {
        var unit = bounds.Width / 20f;
        float X(float value) => bounds.Left + (value * unit);
        float Y(float value) => bounds.Top + (value * unit);
        float S(float value) => value * unit;

        using var pen = new Pen(color, Math.Max(1.35f, 1.7f * dpiScale))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };

        switch (Icon)
        {
            case AppleNavIcon.Overview:
                var cell = S(7.25f);
                var gutter = S(4.5f);
                foreach (var rectangle in new[]
                {
                    new RectangleF(X(0.25f), Y(0.25f), cell, cell),
                    new RectangleF(X(0.25f) + cell + gutter, Y(0.25f), cell, cell),
                    new RectangleF(X(0.25f), Y(0.25f) + cell + gutter, cell, cell),
                    new RectangleF(X(0.25f) + cell + gutter, Y(0.25f) + cell + gutter, cell, cell),
                }) graphics.DrawRoundedRectangle(pen, rectangle, S(2.1f));
                break;

            case AppleNavIcon.Users:
                graphics.DrawEllipse(pen, X(2), Y(1), S(6.5f), S(6.5f));
                graphics.DrawEllipse(pen, X(11.5f), Y(1), S(6.5f), S(6.5f));
                graphics.DrawArc(pen, X(0), Y(8), S(10.5f), S(10), 185, 170);
                graphics.DrawArc(pen, X(9.5f), Y(8), S(10.5f), S(10), 185, 170);
                break;

            case AppleNavIcon.Ai:
                graphics.DrawRoundedRectangle(pen, new RectangleF(X(1.5f), Y(5), S(17), S(13)), S(4));
                graphics.DrawLine(pen, X(10), Y(1), X(10), Y(5));
                graphics.DrawEllipse(pen, X(9), Y(0), S(2), S(2));
                using (var dotBrush = new SolidBrush(color))
                {
                    graphics.FillEllipse(dotBrush, X(5), Y(10), S(2.5f), S(2.5f));
                    graphics.FillEllipse(dotBrush, X(12.5f), Y(10), S(2.5f), S(2.5f));
                }
                graphics.DrawArc(pen, X(6), Y(10), S(8), S(7), 20, 140);
                break;

            case AppleNavIcon.Health:
                using (var heart = new GraphicsPath())
                {
                    heart.AddBezier(X(10), Y(18), X(-2), Y(8), X(2), Y(0), X(10), Y(5));
                    heart.AddBezier(X(10), Y(5), X(18), Y(0), X(22), Y(8), X(10), Y(18));
                    graphics.DrawPath(pen, heart);
                }
                graphics.DrawLines(pen,
                [
                    new PointF(X(2), Y(10)),
                    new PointF(X(6), Y(10)),
                    new PointF(X(8), Y(6)),
                    new PointF(X(11), Y(14)),
                    new PointF(X(13), Y(10)),
                    new PointF(X(18), Y(10)),
                ]);
                break;

            case AppleNavIcon.Console:
                graphics.DrawRoundedRectangle(pen, new RectangleF(X(1), Y(2), S(18), S(16)), S(3));
                graphics.DrawLines(pen,
                [
                    new PointF(X(5), Y(7)),
                    new PointF(X(8), Y(10)),
                    new PointF(X(5), Y(13)),
                ]);
                graphics.DrawLine(pen, X(10), Y(13), X(14), Y(13));
                break;
        }
    }
}

internal static class GraphicsExtensions
{
    internal static void DrawRoundedRectangle(this Graphics graphics, Pen pen, RectangleF bounds, float radius)
    {
        using var path = AppleSurface.RoundedPath(bounds, radius);
        graphics.DrawPath(pen, path);
    }
}
