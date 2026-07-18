using System.Drawing.Drawing2D;

namespace MinimalistAIAnalysis;

internal enum StartupLoadStage
{
    Preparing,
    ProtectedServices,
    PlatformAnalytics,
    RemoteDesktop,
    Ready,
}

internal sealed record StartupLoadPresentation(string Status, string Detail, int ProgressPercent);

internal static class StartupLoadPresentations
{
    public static StartupLoadPresentation For(StartupLoadStage stage) => stage switch
    {
        StartupLoadStage.Preparing => new(
            "Preparing your workspace",
            "Setting up private Analysis controls.",
            12),
        StartupLoadStage.ProtectedServices => new(
            "Checking protected services",
            "Verifying Ollama, bridge, tunnel, models, and recovery.",
            44),
        StartupLoadStage.PlatformAnalytics => new(
            "Loading administrator analytics",
            "Reading Firebase accounts, memberships, and presence.",
            78),
        StartupLoadStage.RemoteDesktop => new(
            "Connecting to the remote desktop",
            "Refreshing owner-only, read-only status through Cloudflare Access.",
            68),
        StartupLoadStage.Ready => new(
            "Analysis is ready",
            "Opening your overview.",
            100),
        _ => throw new ArgumentOutOfRangeException(nameof(stage)),
    };
}

internal sealed class StartupLoadingScreen : Panel
{
    private readonly AppleSurface _card;
    private readonly StartupBrandMark _brandMark;
    private readonly Label _brand;
    private readonly Label _title;
    private readonly Label _status;
    private readonly Label _detail;
    private readonly Label _percentage;
    private readonly Label _privacy;
    private readonly StartupProgressIndicator _progress;

    public StartupLoadStage Stage { get; private set; } = StartupLoadStage.Preparing;

    public StartupLoadingScreen()
    {
        Dock = DockStyle.Fill;
        BackColor = ApplePalette.Canvas;
        AccessibleName = "Loading Minimalist Analysis";
        AccessibleDescription = "Minimalist Analysis is loading protected services and analytics.";
        AccessibleRole = AccessibleRole.Pane;
        TabStop = false;

        var centeringLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            ColumnCount = 3,
            RowCount = 3,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        centeringLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        centeringLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 500));
        centeringLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        centeringLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        centeringLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 320));
        centeringLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 50));

        _card = new AppleSurface
        {
            Dock = DockStyle.Fill,
            BackColor = ApplePalette.Surface,
            CornerRadius = AppleMetrics.HeroRadius,
            StrokeColor = ApplePalette.Hairline,
            DrawStroke = true,
            Margin = Padding.Empty,
            Padding = new Padding(38, 32, 38, 28),
        };

        var content = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            ColumnCount = 1,
            RowCount = 7,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var brandRow = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            ColumnCount = 2,
            RowCount = 1,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        brandRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 54));
        brandRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _brandMark = new StartupBrandMark { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 10, 6) };
        _brand = CreateLabel("Minimalist Analysis", AppleTypography.BodySemibold, ApplePalette.Ink);
        _brand.Dock = DockStyle.Fill;
        _brand.TextAlign = ContentAlignment.MiddleLeft;
        brandRow.Controls.Add(_brandMark, 0, 0);
        brandRow.Controls.Add(_brand, 1, 0);

        _title = CreateLabel("Loading Analysis", AppleTypography.LargeTitleShort, ApplePalette.Ink);
        _title.Dock = DockStyle.Fill;
        _title.TextAlign = ContentAlignment.MiddleLeft;
        _title.AccessibleRole = AccessibleRole.StaticText;

        _status = CreateLabel(string.Empty, AppleTypography.BodySemibold, ApplePalette.Ink);
        _status.Dock = DockStyle.Fill;
        _status.TextAlign = ContentAlignment.BottomLeft;
        _status.AccessibleName = "Loading status";
        _status.AccessibleRole = AccessibleRole.StaticText;

        _detail = CreateLabel(string.Empty, AppleTypography.Body, ApplePalette.Secondary);
        _detail.Dock = DockStyle.Fill;
        _detail.TextAlign = ContentAlignment.TopLeft;
        _detail.AutoEllipsis = true;
        _detail.AccessibleName = "Loading detail";
        _detail.AccessibleRole = AccessibleRole.StaticText;

        var progressHeader = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            ColumnCount = 2,
            RowCount = 1,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        progressHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        progressHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        var progressLabel = CreateLabel("LOADING", AppleTypography.FootnoteSemibold, ApplePalette.Secondary);
        progressLabel.Dock = DockStyle.Fill;
        progressLabel.TextAlign = ContentAlignment.MiddleLeft;
        _percentage = CreateLabel("12%", AppleTypography.FootnoteSemibold, ApplePalette.AccentText);
        _percentage.Dock = DockStyle.Fill;
        _percentage.TextAlign = ContentAlignment.MiddleRight;
        progressHeader.Controls.Add(progressLabel, 0, 0);
        progressHeader.Controls.Add(_percentage, 1, 0);

        _progress = new StartupProgressIndicator { Dock = DockStyle.Fill, Margin = new Padding(0, 5, 0, 5) };

        _privacy = CreateLabel("Protected data stays private to your approved Analysis connection.", AppleTypography.Footnote, ApplePalette.Tertiary);
        _privacy.Dock = DockStyle.Fill;
        _privacy.TextAlign = ContentAlignment.BottomLeft;
        _privacy.AutoEllipsis = true;

        content.Controls.Add(brandRow, 0, 0);
        content.Controls.Add(_title, 0, 1);
        content.Controls.Add(_status, 0, 2);
        content.Controls.Add(_detail, 0, 3);
        content.Controls.Add(progressHeader, 0, 4);
        content.Controls.Add(_progress, 0, 5);
        content.Controls.Add(_privacy, 0, 6);
        _card.Controls.Add(content);
        centeringLayout.Controls.Add(_card, 1, 1);
        Controls.Add(centeringLayout);

        SetStage(StartupLoadStage.Preparing);
        ApplySystemColors();
    }

    public void SetStage(StartupLoadStage stage)
    {
        Stage = stage;
        var presentation = StartupLoadPresentations.For(stage);
        _status.Text = presentation.Status;
        _detail.Text = presentation.Detail;
        _percentage.Text = $"{presentation.ProgressPercent}%";
        _progress.Value = presentation.ProgressPercent;
        AccessibleDescription = $"{presentation.Status}. {presentation.Detail}";
        AccessibilityNotifyClients(AccessibleEvents.NameChange, -1);
    }

    protected override void OnSystemColorsChanged(EventArgs e)
    {
        base.OnSystemColorsChanged(e);
        ApplySystemColors();
    }

    private void ApplySystemColors()
    {
        var highContrast = SystemInformation.HighContrast;
        BackColor = highContrast ? SystemColors.Control : ApplePalette.Canvas;
        _card.BackColor = highContrast ? SystemColors.Window : ApplePalette.Surface;
        _card.StrokeColor = highContrast ? SystemColors.ControlDark : ApplePalette.Hairline;
        _brand.ForeColor = highContrast ? SystemColors.WindowText : ApplePalette.Ink;
        _title.ForeColor = highContrast ? SystemColors.WindowText : ApplePalette.Ink;
        _status.ForeColor = highContrast ? SystemColors.WindowText : ApplePalette.Ink;
        _detail.ForeColor = highContrast ? SystemColors.GrayText : ApplePalette.Secondary;
        _percentage.ForeColor = highContrast ? SystemColors.Highlight : ApplePalette.AccentText;
        _privacy.ForeColor = highContrast ? SystemColors.GrayText : ApplePalette.Tertiary;
        Invalidate(true);
    }

    private static Label CreateLabel(string text, Font font, Color foreColor) => new()
    {
        Text = text,
        Font = font,
        ForeColor = foreColor,
        BackColor = Color.Transparent,
        Margin = Padding.Empty,
        Padding = Padding.Empty,
        AutoSize = false,
        UseMnemonic = false,
    };
}

internal sealed class StartupProgressIndicator : Control
{
    private int _value;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int Value
    {
        get => _value;
        set
        {
            var normalized = Math.Clamp(value, 0, 100);
            if (_value == normalized) return;
            _value = normalized;
            AccessibleDescription = $"Loading progress: {_value} percent.";
            Invalidate();
        }
    }

    public StartupProgressIndicator()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true);
        DoubleBuffered = true;
        TabStop = false;
        AccessibleName = "Loading progress";
        AccessibleRole = AccessibleRole.ProgressBar;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        ApplePainter.Configure(e.Graphics);
        var barHeight = Math.Max(3, AppleMetrics.Scale(this, 4));
        var bounds = new RectangleF(0, Math.Max(0, (Height - barHeight) / 2f), Math.Max(1, Width), barHeight);
        var trackColor = SystemInformation.HighContrast ? SystemColors.ControlDark : ApplePalette.SurfaceSunken;
        var progressColor = SystemInformation.HighContrast ? SystemColors.Highlight : ApplePalette.AccentFill;
        using (var trackPath = AppleSurface.RoundedPath(bounds, barHeight / 2f))
        using (var trackBrush = new SolidBrush(trackColor))
            e.Graphics.FillPath(trackBrush, trackPath);

        if (_value <= 0) return;
        var progressBounds = bounds;
        progressBounds.Width = Math.Max(barHeight, bounds.Width * _value / 100f);
        using var progressPath = AppleSurface.RoundedPath(progressBounds, barHeight / 2f);
        using var progressBrush = new SolidBrush(progressColor);
        e.Graphics.FillPath(progressBrush, progressPath);
    }
}

internal sealed class StartupBrandMark : Control
{
    public StartupBrandMark()
    {
        SetStyle(
            ControlStyles.UserPaint |
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw,
            true);
        DoubleBuffered = true;
        TabStop = false;
        AccessibleName = "Minimalist Analysis";
        AccessibleRole = AccessibleRole.Graphic;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        ApplePainter.Configure(e.Graphics);
        var bounds = new RectangleF(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        var fill = SystemInformation.HighContrast ? SystemColors.Highlight : ApplePalette.AccentFill;
        var ink = SystemInformation.HighContrast ? SystemColors.HighlightText : Color.White;
        using (var path = AppleSurface.RoundedPath(bounds, AppleMetrics.Scale(this, 10)))
        using (var brush = new SolidBrush(fill))
            e.Graphics.FillPath(brush, path);
        TextRenderer.DrawText(
            e.Graphics,
            "M",
            AppleTypography.Get(14f, FontStyle.Bold),
            Rectangle.Round(bounds),
            ink,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }
}
