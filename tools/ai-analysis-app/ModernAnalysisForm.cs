using System.Diagnostics;
using System.Globalization;

namespace MinimalistAIAnalysis;

internal sealed class AnalysisForm : Form
{
    private const string RecoveryTaskStatusKey = "Recovery task";
    private const string RemoteAgentTaskStatusKey = "Remote Analysis agent task";

    private sealed record AdaptiveGridBinding(
        TableLayoutPanel Panel,
        Control[] Items,
        int CompactColumns,
        int StandardColumns,
        int WideColumns,
        float[]? CompactRowWeights = null,
        float[]? CompactColumnWeights = null,
        float[]? StandardColumnWeights = null,
        float[]? WideColumnWeights = null,
        bool UpdateRowDividers = false);

    private static readonly Color Ink = ApplePalette.Ink;
    private static readonly Color Accent = ApplePalette.Blue;
    private static readonly Color Canvas = Color.FromArgb(244, 244, 246);
    private static readonly Color Card = ApplePalette.Surface;
    private static readonly Color Muted = ApplePalette.Secondary;
    private static readonly Color Border = ApplePalette.Line;
    private static readonly Color Success = ApplePalette.Green;
    private static readonly Color Warning = ApplePalette.Orange;

    private readonly BridgeClient _client;
    private readonly RemoteAnalysisClient _remoteClient;
    private readonly Panel _pageHost = new() { Dock = DockStyle.Fill, BackColor = Canvas };
    private readonly Dictionary<string, Control> _pages = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, AppleNavButton> _navButtons = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<Label>> _metricValues = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<Label>> _statusValues = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<Control> _actionButtons = [];
    private readonly List<Panel> _responsivePages = [];
    private readonly List<AdaptiveGridBinding> _adaptiveGrids = [];
    private readonly List<Control> _pageIntros = [];
    private readonly Label _pageTitle = new();
    private readonly Label _warning = new();
    private readonly Label _liveStatus = new();
    private readonly Label _modeValue = new();
    private readonly Label _checkedValue = new();
    private readonly Label _membershipDetail = new();
    private readonly Label _conversionDetail = new();
    private readonly Label _analyticsChecked = new();
    private readonly Label _modelCount = new();
    private readonly Label _healthDetail = new();
    private readonly Label _overviewSignal = new();
    private readonly Label _modelActionStatus = new();
    private readonly Label _workspaceStatus = new();
    private readonly Label _logDirectoryStatus = new();
    private readonly UserGrowthChart _overviewGrowth = new();
    private readonly UserGrowthChart _usersGrowth = new();
    private readonly ActivityChart _activityChart = new();
    private readonly DataGridView _recent = new();
    private readonly DataGridView _userDirectory = new();
    private readonly TextBox _userSearch = new();
    private readonly Label _userDirectoryCount = new();
    private readonly ComboBox _idle = new();
    private readonly RichTextBox _console = new();
    private readonly TextBox _consoleInput = new();
    private readonly List<string> _consoleHistory = [];
    private readonly AppleActionButton _refreshButton;
    private readonly ComboBox _connectionSelector = new();
    private readonly AppleActionButton _remoteSessionButton;
    private readonly StartupLoadingScreen _startupLoadingScreen = new();
    private readonly System.Windows.Forms.Timer _liveTimer = new() { Interval = 30_000 };
    private readonly CancellationTokenSource _lifetimeCancellation = new();
    private TableLayoutPanel? _shellLayout;
    private TableLayoutPanel? _headerLayout;
    private TableLayoutPanel? _bottomNavigationLayout;
    private TableLayoutPanel? _overviewLayout;
    private TableLayoutPanel? _usersLayout;
    private TableLayoutPanel? _aiLayout;
    private TableLayoutPanel? _healthLayout;
    private TableLayoutPanel? _consoleLayout;
    private Panel? _consolePage;
    private FlowLayoutPanel? _aiActions;
    private FlowLayoutPanel? _bridgeActions;
    private Control? _aiTimeoutPanel;
    private AppleSurface? _warningBanner;
    private Button[] _modeButtons = [];
    private AppleActionButton? _fastModelButton;
    private AppleActionButton? _smartModelButton;
    private AppleActionButton? _visionModelButton;
    private AppleActionButton? _activeModelButton;
    private AppleActionButton? _copyUserUidButton;
    private AppleActionButton? _tunnelToggleButton;
    private AnalysisSnapshot? _lastSnapshot;
    private PlatformSnapshot _platformSnapshot = new(0, 0, 0, 0, 0, [], [], DateTime.MinValue, "Platform analytics are loading…");
    private UserDirectoryEntry[] _userDirectoryEntries = [];
    private bool _userDirectoryAvailable;
    private DateTime _lastPlatformRefresh = DateTime.MinValue;
    private int _consoleHistoryIndex;
    private bool _busy;
    private bool _refreshing;
    private bool _closeRequested;
    private bool _closeReady;
    private TaskCompletionSource<bool>? _refreshCompletion;
    private AnalysisWindowWidthClass? _appliedWindowWidthClass;
    private bool? _appliedShortWindow;
    private string _activePageKey = "Overview";
    private CancellationTokenSource? _modelInstallCancellation;
    private AnalysisConnectionMode _connectionMode = AnalysisConnectionMode.Local;
    private bool _initializing = true;
    private bool _initialLoadStarted;

    public AnalysisForm(BridgeClient client, RemoteAnalysisClient remoteClient)
    {
        _client = client;
        _remoteClient = remoteClient;
        Text = "Minimalist Analysis";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 640);
        var workArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1360, 860);
        Size = new Size(Math.Min(1360, Math.Max(900, workArea.Width - 48)), Math.Min(860, Math.Max(640, workArea.Height - 48)));
        BackColor = Canvas;
        ForeColor = Ink;
        Font = new Font("Segoe UI Variable Text", 9.75f);
        AutoScaleMode = AutoScaleMode.Dpi;
        KeyPreview = true;
        DoubleBuffered = true;

        _refreshButton = ModernButton("Refresh", async () => await RefreshAsync(), 96);
        _remoteSessionButton = ModernButton("Sign in", ToggleRemoteSessionAsync, 92);
        _remoteSessionButton.Visible = false;

        _shellLayout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Canvas };
        _shellLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _shellLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _shellLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
        _shellLayout.Controls.Add(BuildHeader(), 0, 0);
        _shellLayout.Controls.Add(_pageHost, 0, 1);
        _shellLayout.Controls.Add(BuildBottomNavigation(), 0, 2);
        Controls.Add(_shellLayout);

        AddPage("Overview", BuildOverviewPage());
        AddPage("Users", BuildUsersPage());
        AddPage("AI", BuildAiPage());
        AddPage("Health", BuildHealthPage());
        AddPage("Console", BuildConsolePage());
        ShowPage("Overview");
        ApplyResponsiveLayout(force: true);
        Controls.Add(_startupLoadingScreen);
        _startupLoadingScreen.BringToFront();
        _shellLayout.Enabled = false;

        HandleCreated += (_, _) => AppleWindowChrome.ApplyLightTheme(Handle);
        Resize += (_, _) => ApplyResponsiveLayout();
        DpiChanged += (_, _) => ApplyResponsiveLayout(force: true);
        _liveTimer.Tick += async (_, _) => await RefreshAsync(includePlatform: DateTime.Now - _lastPlatformRefresh > TimeSpan.FromMinutes(5), automatic: true);
        KeyDown += async (_, args) => await HandleShortcutAsync(args);
        FormClosing += async (_, args) => await CloseGracefullyAsync(args);
        FormClosed += (_, _) =>
        {
            _liveTimer.Stop();
            _liveTimer.Dispose();
            _lifetimeCancellation.Dispose();
            _modelInstallCancellation?.Cancel();
            _modelInstallCancellation?.Dispose();
        };

        Shown += async (_, _) =>
        {
            AppendConsole("Site Analysis console ready. Type 'help' for commands.");
            AppendConsole("Data source: This PC. Remote mode is read-only and requires Cloudflare Access sign-in.");
            await InitializeAsync();
        };
    }

    private Control BuildHeader()
    {
        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 6, RowCount = 3, Padding = new Padding(34, 7, 34, 7), BackColor = Card };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 106));
        header.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        header.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        header.RowStyles.Add(new RowStyle(SizeType.Absolute, 0));

        var mark = new AppleSurface
        {
            AccessibleName = "Minimalist Analysis",
            Dock = DockStyle.Fill,
            BackColor = ApplePalette.BlueFill,
            DrawStroke = false,
            CornerRadius = 9,
            Margin = new Padding(0, 6, 10, 6),
        };
        mark.Controls.Add(new Label
        {
            Text = "M",
            AccessibleName = "Minimalist Analysis",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            Font = new Font("Segoe UI Variable Display", 13.5f, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleCenter,
        });
        _pageTitle.Text = "Minimalist Analysis";
        _pageTitle.Dock = DockStyle.Fill;
        _pageTitle.ForeColor = Ink;
        _pageTitle.Font = new Font("Segoe UI Variable Display", 11.5f, FontStyle.Bold);
        _pageTitle.TextAlign = ContentAlignment.MiddleLeft;
        _pageTitle.AutoEllipsis = true;
        _liveStatus.AutoSize = false;
        _liveStatus.Dock = DockStyle.Fill;
        _liveStatus.AutoEllipsis = true;
        _liveStatus.MinimumSize = Size.Empty;
        _liveStatus.Padding = new Padding(12, 0, 12, 0);
        _liveStatus.TextAlign = ContentAlignment.MiddleRight;
        _liveStatus.ForeColor = Success;
        _liveStatus.Font = new Font("Segoe UI Variable Text", 9.25f, FontStyle.Bold);
        _connectionSelector.DropDownStyle = ComboBoxStyle.DropDownList;
        _connectionSelector.Items.AddRange(["This PC", "Remote desktop"]);
        _connectionSelector.SelectedIndex = 0;
        _connectionSelector.Dock = DockStyle.Fill;
        _connectionSelector.Margin = new Padding(8, 10, 6, 10);
        _connectionSelector.AccessibleName = "Analysis data source";
        _connectionSelector.AccessibleDescription = "Choose This PC for administrator controls or Remote desktop for read-only status through Cloudflare Access.";
        _connectionSelector.SelectionChangeCommitted += async (_, _) => await ChangeConnectionModeAsync();
        _remoteSessionButton.Dock = DockStyle.Fill;
        _remoteSessionButton.Margin = new Padding(4, 6, 0, 6);
        _remoteSessionButton.AccessibleDescription = "Sign in to the read-only remote Analysis agent with Cloudflare Access.";
        _refreshButton.Dock = DockStyle.Fill;
        _refreshButton.Margin = new Padding(6, 6, 0, 6);

        _warningBanner = new AppleSurface
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            BackColor = Color.FromArgb(255, 246, 229),
            StrokeColor = Color.FromArgb(240, 223, 194),
            CornerRadius = 10,
            Padding = new Padding(12, 8, 12, 8),
            Margin = new Padding(48, 4, 0, 1),
            Visible = false,
        };
        _warning.AutoSize = true;
        _warning.Dock = DockStyle.Top;
        _warning.ForeColor = Warning;
        _warning.Font = new Font("Segoe UI Variable Text", 8.75f, FontStyle.Bold);
        _warning.TextAlign = ContentAlignment.MiddleLeft;
        _warning.AutoEllipsis = false;
        _warningBanner.Controls.Add(_warning);
        _warning.TextChanged += (_, _) => UpdateWarningBanner();

        header.Controls.Add(mark, 0, 0);
        header.Controls.Add(_pageTitle, 1, 0);
        header.Controls.Add(_connectionSelector, 2, 0);
        header.Controls.Add(_remoteSessionButton, 3, 0);
        header.Controls.Add(_liveStatus, 4, 0);
        header.Controls.Add(_refreshButton, 5, 0);
        header.Controls.Add(_warningBanner, 0, 1);
        header.SetColumnSpan(_warningBanner, 6);
        header.Resize += (_, _) => UpdateWarningBanner();
        header.Paint += (_, e) =>
        {
            using var pen = new Pen(Border);
            e.Graphics.DrawLine(pen, 0, header.Height - 1, header.Width, header.Height - 1);
        };
        _headerLayout = header;
        return header;
    }

    private Control BuildBottomNavigation()
    {
        var outer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Padding = new Padding(16, 3, 16, 5), BackColor = Canvas };
        outer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        outer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 680));
        outer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var surface = new AppleSurface { Dock = DockStyle.Fill, CornerRadius = 18, Padding = new Padding(4), Margin = new Padding(0), BackColor = Card, StrokeColor = Border };
        var nav = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 5, RowCount = 1, Margin = new Padding(0), BackColor = Card };
        nav.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        foreach (var _ in Enumerable.Range(0, 5)) nav.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
        var entries = new[]
        {
            ("Overview", "Overview", AppleNavIcon.Overview),
            ("Users", "Users", AppleNavIcon.Users),
            ("AI", "AI Control", AppleNavIcon.Ai),
            ("Health", "Health", AppleNavIcon.Health),
            ("Console", "Console", AppleNavIcon.Console),
        };
        for (var index = 0; index < entries.Length; index++)
        {
            var entry = entries[index];
            var button = new AppleNavButton { Text = entry.Item2, Tag = entry.Item1, Icon = entry.Item3, Dock = DockStyle.Fill, Margin = new Padding(1, 0, 1, 0), AccessibleName = entry.Item2 };
            button.Click += (_, _) => ShowPage(entry.Item1);
            _navButtons[entry.Item1] = button;
            nav.Controls.Add(button, index, 0);
        }
        surface.Controls.Add(nav);
        outer.Controls.Add(surface, 1, 0);
        _bottomNavigationLayout = outer;
        outer.Resize += (_, _) => UpdateBottomNavigationWidth();
        return outer;
    }

    private Control BuildOverviewPage()
    {
        var page = PagePanel();
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, RowCount = 4, BackColor = Canvas };
        _overviewLayout = layout;
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 124));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 255));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 220));
        layout.Controls.Add(PageIntro("Overview", "Live operations, memberships, and AI availability."), 0, 0);
        layout.Controls.Add(BuildMetricRow(), 0, 1);

        var insights = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 10, 0, 10) };
        insights.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 68)); insights.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        var insightItems = new[]
        {
            ChartCard("User growth", "New accounts during the last 30 days", _overviewGrowth),
            BuildMembershipCard(),
        };
        insights.Controls.Add(insightItems[0], 0, 0);
        insights.Controls.Add(insightItems[1], 1, 0);
        RegisterAdaptiveGrid(
            insights,
            insightItems,
            compactColumns: 1,
            standardColumns: 2,
            wideColumns: 2,
            compactRowWeights: [58, 42],
            standardColumnWeights: [62, 38],
            wideColumnWeights: [68, 32]);
        layout.Controls.Add(insights, 0, 2);

        var lower = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 4, 0, 0) };
        lower.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 56)); lower.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44));
        var overviewHealth = BuildStatusCard("System pulse");
        var signal = CardPanel(new Padding(22));
        var signalLayout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3 };
        signalLayout.Controls.Add(CardTitle("Operational summary"), 0, 0);
        _overviewSignal.Dock = DockStyle.Fill; _overviewSignal.Font = new Font("Segoe UI", 13, FontStyle.Bold); _overviewSignal.TextAlign = ContentAlignment.MiddleLeft; _overviewSignal.AutoEllipsis = true;
        signalLayout.Controls.Add(_overviewSignal, 0, 1);
        signalLayout.Controls.Add(new Label { Text = "Overview stays aggregate-only. Usernames and exact Firebase UIDs appear only in the protected Users directory.", Dock = DockStyle.Fill, ForeColor = Muted, TextAlign = ContentAlignment.TopLeft, AutoEllipsis = true }, 0, 2);
        signal.Controls.Add(signalLayout);
        lower.Controls.Add(overviewHealth, 0, 0);
        lower.Controls.Add(signal, 1, 0);
        RegisterAdaptiveGrid(
            lower,
            [overviewHealth, signal],
            compactColumns: 1,
            standardColumns: 2,
            wideColumns: 2,
            compactRowWeights: [50, 50],
            standardColumnWeights: [52, 48],
            wideColumnWeights: [56, 44]);
        layout.Controls.Add(lower, 0, 3);
        page.Controls.Add(layout);
        return page;
    }

    private Control BuildUsersPage()
    {
        var page = PagePanel();
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 4, BackColor = Canvas };
        _usersLayout = layout;
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 124));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 330));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(PageIntro("Users", "Live identities, memberships, presence, and account growth."), 0, 0);
        layout.Controls.Add(BuildMetricRow(), 0, 1);

        var directoryBand = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 6, 0, 8) };
        directoryBand.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 70));
        directoryBand.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));
        var directoryItems = new[]
        {
            BuildUserDirectoryCard(),
            ChartCard("Account growth", "Daily Firebase Auth registrations", _usersGrowth),
        };
        directoryBand.Controls.Add(directoryItems[0], 0, 0);
        directoryBand.Controls.Add(directoryItems[1], 1, 0);
        RegisterAdaptiveGrid(
            directoryBand,
            directoryItems,
            compactColumns: 1,
            standardColumns: 2,
            wideColumns: 2,
            compactRowWeights: [66, 34],
            standardColumnWeights: [65, 35],
            wideColumnWeights: [70, 30]);
        layout.Controls.Add(directoryBand, 0, 2);

        var notes = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 112), ColumnCount = 3, Margin = new Padding(0, 10, 0, 0), BackColor = Canvas };
        notes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3f)); notes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3f)); notes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.4f));
        var noteItems = new[]
        {
            InfoCard("Active now", "A user is active when their authenticated RTDB presence state is online."),
            InfoCard("Paid", "Active and trialing Stripe subscriptions are counted, including unmapped prices."),
            InfoCard("Privacy", "Identity data stays in memory; the temporary Auth export is deleted immediately."),
        };
        for (var index = 0; index < noteItems.Length; index++) notes.Controls.Add(noteItems[index], index, 0);
        RegisterAdaptiveGrid(notes, noteItems, compactColumns: 1, standardColumns: 3, wideColumns: 3);
        layout.Controls.Add(notes, 0, 3);
        page.Controls.Add(layout);
        return page;
    }

    private Control BuildAiPage()
    {
        var page = PagePanel();
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 6, BackColor = Canvas };
        _aiLayout = layout;
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 140));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 218));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 164));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 148));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(PageIntro("AI Control", "Control availability, model lifecycle, request volume, and privacy-safe local activity."), 0, 0);
        layout.Controls.Add(BuildModePanel(), 0, 1);

        var middle = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 8, 0, 8) };
        middle.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 64)); middle.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36));
        var aiMiddleItems = new[]
        {
            ChartCard("AI request activity", "Protected bridge requests during the last 24 hours", _activityChart),
            BuildStatusCard("AI service health"),
        };
        middle.Controls.Add(aiMiddleItems[0], 0, 0);
        middle.Controls.Add(aiMiddleItems[1], 1, 0);
        RegisterAdaptiveGrid(
            middle,
            aiMiddleItems,
            compactColumns: 1,
            standardColumns: 2,
            wideColumns: 2,
            compactRowWeights: [55, 45],
            standardColumnWeights: [58, 42],
            wideColumnWeights: [64, 36]);
        layout.Controls.Add(middle, 0, 2);
        layout.Controls.Add(BuildWebsiteAiRoutingCard(), 0, 3);
        layout.Controls.Add(BuildRecentActivity(), 0, 4);
        layout.Controls.Add(BuildAiActions(), 0, 5);
        page.Controls.Add(layout);
        return page;
    }

    private Control BuildHealthPage()
    {
        var page = PagePanel();
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 4, BackColor = Canvas };
        _healthLayout = layout;
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 260));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 268));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(PageIntro("Health", "Protected AI services, the remote Analysis agent, public tunnel, models, and recovery tasks."), 0, 0);
        layout.Controls.Add(BuildStatusCard("Live services", includeRecoveryTask: true), 0, 1);
        var diagnostics = CardPanel(new Padding(24));
        var diagnosticLayout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4 };
        diagnosticLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        diagnosticLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        diagnosticLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        diagnosticLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        diagnosticLayout.Controls.Add(CardTitle("Diagnostics"), 0, 0);
        _healthDetail.Dock = DockStyle.Fill; _healthDetail.Font = new Font("Segoe UI", 12, FontStyle.Bold); _healthDetail.TextAlign = ContentAlignment.MiddleLeft; _healthDetail.AutoEllipsis = true;
        diagnosticLayout.Controls.Add(_healthDetail, 0, 1);
        _workspaceStatus.Dock = DockStyle.Fill; _workspaceStatus.ForeColor = Muted; _workspaceStatus.TextAlign = ContentAlignment.MiddleLeft; _workspaceStatus.AutoEllipsis = true;
        diagnosticLayout.Controls.Add(_workspaceStatus, 0, 2);
        _logDirectoryStatus.Text = $"Local metadata logs\n{_client.LogDirectory}"; _logDirectoryStatus.Dock = DockStyle.Fill; _logDirectoryStatus.ForeColor = Muted; _logDirectoryStatus.TextAlign = ContentAlignment.TopLeft; _logDirectoryStatus.AutoEllipsis = true;
        diagnosticLayout.Controls.Add(_logDirectoryStatus, 0, 3);
        diagnostics.Controls.Add(diagnosticLayout);
        layout.Controls.Add(diagnostics, 0, 2);
        layout.Controls.Add(BuildBridgeActionRow(), 0, 3);
        page.Controls.Add(layout);
        return page;
    }

    private Control BuildConsolePage()
    {
        var page = new Panel { Dock = DockStyle.Fill, Padding = new Padding(34, 16, 34, 12), BackColor = Canvas };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, BackColor = Canvas };
        _consolePage = page;
        _consoleLayout = layout;
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(PageIntro("Console", "Run approved AI, infrastructure, and guarded user-moderation operations."), 0, 0);
        layout.Controls.Add(BuildConsoleSurface(), 0, 1);
        layout.Controls.Add(new Label { Text = "◇  Destructive moderation commands require exact Firebase IDs, typed confirmation, and a second confirmation dialog.", Dock = DockStyle.Top, AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 8.75f), Padding = new Padding(0, 6, 0, 2), TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
        page.Controls.Add(layout);
        return page;
    }

    private Control BuildConsoleSurface()
    {
        var highContrast = SystemInformation.HighContrast;
        var consoleColor = highContrast ? SystemColors.Window : Color.FromArgb(23, 24, 28);
        var consoleText = highContrast ? SystemColors.WindowText : Color.FromArgb(237, 237, 242);
        var inputColor = highContrast ? SystemColors.Window : Color.FromArgb(36, 37, 44);
        var inputStroke = highContrast ? SystemColors.ControlDark : Color.FromArgb(72, 73, 82);
        var surface = new AppleSurface
        {
            Dock = DockStyle.Fill,
            CornerRadius = 16,
            BackColor = consoleColor,
            StrokeColor = highContrast ? SystemColors.ControlDark : Color.FromArgb(54, 55, 63),
            Padding = new Padding(18, 10, 18, 16),
            Margin = new Padding(0, 6, 0, 6),
            AccessibleName = "Administrator console",
            AccessibleDescription = "Approved system and guarded moderation commands.",
        };
        var terminal = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, BackColor = consoleColor, Padding = Padding.Empty, Margin = Padding.Empty };
        terminal.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        terminal.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        terminal.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        terminal.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        var chrome = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = consoleColor, Padding = new Padding(0, 1, 0, 1), Margin = Padding.Empty };
        chrome.Controls.Add(ConsoleButton("Clear", () => { _console.Clear(); return Task.CompletedTask; }, 68));
        chrome.Controls.Add(ConsoleButton("Copy", CopyConsoleAsync, 68));
        terminal.Controls.Add(chrome, 0, 0);
        _console.Dock = DockStyle.Fill; _console.ReadOnly = true; _console.BackColor = consoleColor; _console.ForeColor = consoleText; _console.BorderStyle = BorderStyle.None; _console.Font = new Font("Cascadia Mono", 9.5f); _console.Margin = Padding.Empty; _console.Padding = new Padding(6); _console.DetectUrls = false; _console.AccessibleName = "Console output"; _console.AccessibleDescription = "Read-only results from approved system and moderation commands.";
        terminal.Controls.Add(_console, 0, 1);

        var categories = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, BackColor = consoleColor, Padding = new Padding(0, 4, 0, 4), Margin = Padding.Empty };
        categories.Controls.Add(ConsoleButton("System", () => { ShowConsoleCategory("system"); return Task.CompletedTask; }, 96));
        categories.Controls.Add(ConsoleButton("Moderation", () => { ShowConsoleCategory("moderation"); return Task.CompletedTask; }, 112));
        categories.Controls.Add(ConsoleButton("Help", () => { ShowConsoleCategory("help"); return Task.CompletedTask; }, 78));
        terminal.Controls.Add(categories, 0, 2);

        var command = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, BackColor = consoleColor, Padding = new Padding(0, 8, 0, 0), Margin = Padding.Empty };
        command.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var inputSurface = new AppleSurface { Dock = DockStyle.Fill, CornerRadius = 10, Padding = new Padding(13, 8, 13, 8), Margin = Padding.Empty, BackColor = inputColor, StrokeColor = inputStroke, AccessibleName = "Console command field" };
        _consoleInput.Dock = DockStyle.Fill; _consoleInput.BorderStyle = BorderStyle.None; _consoleInput.BackColor = inputColor; _consoleInput.ForeColor = consoleText; _consoleInput.Font = new Font("Cascadia Mono", 9.75f); _consoleInput.PlaceholderText = "Type a command and press Enter to run"; _consoleInput.Margin = Padding.Empty; _consoleInput.AccessibleName = "Console command"; _consoleInput.AccessibleDescription = "Type an approved command. Use Up and Down Arrow to navigate command history.";
        _consoleInput.KeyDown += async (_, args) => await HandleConsoleInputKeyDownAsync(args);
        _consoleInput.Enter += (_, _) => inputSurface.Invalidate();
        _consoleInput.Leave += (_, _) => inputSurface.Invalidate();
        inputSurface.Paint += (_, paint) =>
        {
            if (!_consoleInput.Focused || inputSurface.Width < 3 || inputSurface.Height < 3) return;
            var scale = Math.Max(1f, inputSurface.DeviceDpi / 96f);
            var inset = Math.Max(1f, scale);
            using var path = AppleSurface.RoundedPath(
                new RectangleF(inset, inset, inputSurface.Width - (inset * 2), inputSurface.Height - (inset * 2)),
                10f * scale);
            using var pen = new Pen(highContrast ? SystemColors.Highlight : Accent, Math.Max(1.5f, 1.5f * scale));
            paint.Graphics.DrawPath(pen, path);
        };
        inputSurface.Controls.Add(_consoleInput);
        command.Controls.Add(inputSurface, 0, 0);
        terminal.Controls.Add(command, 0, 3);
        surface.Controls.Add(terminal);
        return surface;
    }

    private Control BuildMetricRow()
    {
        var band = new AppleSurface { Dock = DockStyle.Fill, CornerRadius = 16, Padding = new Padding(8, 6, 8, 6), Margin = new Padding(0, 8, 0, 10), DrawStroke = true, StrokeColor = Border };
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, Margin = new Padding(0), BackColor = Card };
        for (var index = 0; index < 4; index++) row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        var metricItems = new[]
        {
            MetricBlock("total", "Registered users", "Firebase Auth accounts", true),
            MetricBlock("active", "Active now", "Live website presence", true),
            MetricBlock("paid", "Paid memberships", "Active or trialing", true),
            MetricBlock("new", "New users · 30d", "Account creation trend", false),
        };
        for (var index = 0; index < metricItems.Length; index++) row.Controls.Add(metricItems[index], index, 0);
        RegisterAdaptiveGrid(row, metricItems, compactColumns: 2, standardColumns: 4, wideColumns: 4, updateRowDividers: true);
        band.Controls.Add(row);
        return band;
    }

    private Control BuildMembershipCard()
    {
        var card = CardPanel(new Padding(24));
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 7 };
        layout.Controls.Add(CardTitle("Membership analysis"), 0, 0);
        layout.Controls.Add(MutedLabel("Subscription health"), 0, 1);
        _membershipDetail.Dock = DockStyle.Fill; _membershipDetail.Font = new Font("Segoe UI", 13, FontStyle.Bold); layout.Controls.Add(_membershipDetail, 0, 2);
        layout.Controls.Add(MutedLabel("Paid conversion"), 0, 3);
        _conversionDetail.Dock = DockStyle.Fill; _conversionDetail.Font = new Font("Segoe UI", 13, FontStyle.Bold); layout.Controls.Add(_conversionDetail, 0, 4);
        layout.Controls.Add(MutedLabel("Analytics source"), 0, 5);
        _analyticsChecked.Dock = DockStyle.Fill; _analyticsChecked.Font = new Font("Segoe UI", 9, FontStyle.Bold); _analyticsChecked.AutoEllipsis = true; layout.Controls.Add(_analyticsChecked, 0, 6);
        card.Controls.Add(layout);
        return card;
    }

    private Control BuildModePanel()
    {
        var panel = new AppleSurface { Dock = DockStyle.Fill, BackColor = Card, Padding = new Padding(20, 12, 20, 12), Margin = new Padding(0, 6, 0, 8), CornerRadius = 16, StrokeColor = Border };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, BackColor = Card, Margin = Padding.Empty };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
        var left = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, BackColor = Card };
        left.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
        left.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        left.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        left.Controls.Add(CardTitle("AI mode"), 0, 0);
        var segment = new AppleSurface { Dock = DockStyle.Fill, CornerRadius = 10, Padding = new Padding(1), Margin = new Padding(0, 3, 26, 3), StrokeColor = Border, BackColor = Card };
        var modes = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Margin = Padding.Empty, BackColor = Card };
        modes.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _modeButtons = [ModeButton("Off", "off"), ModeButton("On", "on"), ModeButton("Auto", "auto")];
        for (var index = 0; index < 3; index++) { modes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3f)); modes.Controls.Add(_modeButtons[index], index, 0); }
        segment.Controls.Add(modes);
        left.Controls.Add(segment, 0, 1);
        left.Controls.Add(new Label { Text = "Auto wakes AI for approved requests and sleeps it after the selected timeout.", Dock = DockStyle.Fill, ForeColor = Muted, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true }, 0, 2);
        layout.Controls.Add(left, 0, 0);
        layout.Controls.Add(SummaryBlock("Current mode", _modeValue), 1, 0);
        layout.Controls.Add(SummaryBlock("Last checked", _checkedValue), 2, 0);
        panel.Controls.Add(layout);
        return panel;
    }

    private Control BuildStatusCard(string title, bool includeRecoveryTask = false)
    {
        var card = CardPanel(new Padding(22, 18, 22, 16));
        var statuses = new List<(string Key, string Name)>
        {
            ("Protected Ollama", "Protected Ollama"),
            ("Protected bridge", "Protected bridge"),
            ("Public tunnel", "Public tunnel"),
            ("Approved models", "Approved models"),
        };
        if (includeRecoveryTask)
        {
            statuses.Add((RemoteAgentTaskStatusKey, AnalysisAppLogic.RemoteAnalysisAgentTaskName));
            statuses.Add((RecoveryTaskStatusKey, AnalysisAppLogic.PublicGatewayRecoveryTaskName));
        }

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = statuses.Count + 1 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        for (var index = 0; index < statuses.Count; index++)
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / statuses.Count));
        layout.Controls.Add(CardTitle(title), 0, 0);
        var row = 1;
        foreach (var status in statuses)
        {
            var value = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight, Font = new Font(Font, FontStyle.Bold), Text = "Checking…", AutoEllipsis = true, AccessibleName = $"{status.Name} status" };
            Register(_statusValues, status.Key, value);
            var statusRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = Padding.Empty };
            statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55)); statusRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            var nameLabel = new Label { Text = status.Name, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, AccessibleName = status.Name };
            if (status.Key == RecoveryTaskStatusKey)
                nameLabel.AccessibleDescription = "The hidden Windows scheduled task that restores the public gateway after sign-in and while this computer is running.";
            else if (status.Key == RemoteAgentTaskStatusKey)
                nameLabel.AccessibleDescription = "The hidden, non-elevated Windows task that runs the read-only remote Analysis agent after sign-in.";
            statusRow.Controls.Add(nameLabel, 0, 0);
            statusRow.Controls.Add(value, 1, 0);
            layout.Controls.Add(statusRow, 0, row++);
        }
        card.Controls.Add(layout);
        return card;
    }

    private Control BuildRecentActivity()
    {
        var card = CardPanel(new Padding(18, 12, 18, 12));
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(CardTitle("Recent local activity"), 0, 0);
        _recent.Dock = DockStyle.Fill; _recent.BackgroundColor = Card; _recent.BorderStyle = BorderStyle.None; _recent.ReadOnly = true; _recent.AllowUserToAddRows = false; _recent.AllowUserToDeleteRows = false; _recent.AllowUserToResizeRows = false; _recent.RowHeadersVisible = false; _recent.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill; _recent.SelectionMode = DataGridViewSelectionMode.FullRowSelect; _recent.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal; _recent.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None; _recent.GridColor = Border; _recent.RowTemplate.Height = 32; _recent.ColumnHeadersHeight = 34;
        _recent.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle { BackColor = Color.FromArgb(248, 249, 251), ForeColor = Ink, Font = new Font(Font, FontStyle.Bold), Padding = new Padding(5), SelectionBackColor = Color.FromArgb(248, 249, 251), SelectionForeColor = Ink };
        _recent.EnableHeadersVisualStyles = false; _recent.DefaultCellStyle = new DataGridViewCellStyle { BackColor = Card, ForeColor = Ink, SelectionBackColor = Color.FromArgb(245, 246, 248), SelectionForeColor = Ink };
        _recent.Columns.Add("Time", "Time"); _recent.Columns.Add("Feature", "Feature"); _recent.Columns.Add("Model", "Model"); _recent.Columns.Add("Duration", "Duration"); _recent.Columns.Add("Result", "Result");
        layout.Controls.Add(_recent, 0, 1); card.Controls.Add(layout); return card;
    }

    private Control BuildUserDirectoryCard()
    {
        var card = CardPanel(new Padding(20, 16, 20, 12));
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, BackColor = Card };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));

        var header = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Card, Margin = Padding.Empty };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 326));
        var heading = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, BackColor = Card, Margin = Padding.Empty };
        heading.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        heading.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        heading.Controls.Add(CardTitle("User directory"), 0, 0);
        heading.Controls.Add(new Label
        {
            Text = "Automatic Firebase identity matching",
            Dock = DockStyle.Fill,
            ForeColor = Muted,
            Font = new Font("Segoe UI Variable Text", 8.75f),
            TextAlign = ContentAlignment.TopLeft,
        }, 0, 1);
        header.Controls.Add(heading, 0, 0);

        var directoryTools = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Card,
            Padding = new Padding(8, 8, 0, 8),
            Margin = Padding.Empty,
        };
        var searchSurface = new AppleSurface
        {
            Size = new Size(218, 36),
            BackColor = Color.FromArgb(240, 240, 243),
            StrokeColor = Border,
            CornerRadius = 10,
            Padding = new Padding(11, 8, 11, 7),
            Margin = Padding.Empty,
        };
        _userSearch.Dock = DockStyle.Fill;
        _userSearch.BorderStyle = BorderStyle.None;
        _userSearch.BackColor = Color.FromArgb(240, 240, 243);
        _userSearch.ForeColor = Ink;
        _userSearch.Font = new Font("Segoe UI Variable Text", 9.25f);
        _userSearch.PlaceholderText = "Search user or UID";
        _userSearch.AccessibleName = "Search users by name, handle, or Firebase UID";
        _userSearch.TextChanged += (_, _) => RefreshUserDirectoryRows();
        _userSearch.KeyDown += (_, args) =>
        {
            if (args.KeyCode != Keys.Escape || _userSearch.TextLength == 0) return;
            _userSearch.Clear();
            args.SuppressKeyPress = true;
        };
        searchSurface.Controls.Add(_userSearch);
        directoryTools.Controls.Add(searchSurface);

        _copyUserUidButton = ModernButton("Copy UID", CopySelectedUserUidAsync, 92);
        _copyUserUidButton.Dock = DockStyle.None;
        _copyUserUidButton.Size = new Size(92, 36);
        _copyUserUidButton.Margin = new Padding(8, 0, 0, 0);
        _copyUserUidButton.Enabled = false;
        _copyUserUidButton.AccessibleDescription = "Copies the exact Firebase UID for the selected user";
        directoryTools.Controls.Add(_copyUserUidButton);
        header.Controls.Add(directoryTools, 1, 0);
        layout.Controls.Add(header, 0, 0);

        _userDirectory.Dock = DockStyle.Fill;
        _userDirectory.BackgroundColor = Card;
        _userDirectory.BorderStyle = BorderStyle.None;
        _userDirectory.ReadOnly = true;
        _userDirectory.AllowUserToAddRows = false;
        _userDirectory.AllowUserToDeleteRows = false;
        _userDirectory.AllowUserToResizeRows = false;
        _userDirectory.AllowUserToOrderColumns = false;
        _userDirectory.MultiSelect = false;
        _userDirectory.RowHeadersVisible = false;
        _userDirectory.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _userDirectory.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _userDirectory.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        _userDirectory.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        _userDirectory.GridColor = Border;
        _userDirectory.RowTemplate.Height = 38;
        _userDirectory.ColumnHeadersHeight = 34;
        _userDirectory.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
        _userDirectory.EnableHeadersVisualStyles = false;
        _userDirectory.ClipboardCopyMode = DataGridViewClipboardCopyMode.EnableWithoutHeaderText;
        _userDirectory.AccessibleName = "Live user directory";
        _userDirectory.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle
        {
            BackColor = Color.FromArgb(248, 249, 251),
            ForeColor = Ink,
            Font = new Font("Segoe UI Variable Text", 8.75f, FontStyle.Bold),
            Padding = new Padding(5),
            SelectionBackColor = Color.FromArgb(248, 249, 251),
            SelectionForeColor = Ink,
        };
        _userDirectory.DefaultCellStyle = new DataGridViewCellStyle
        {
            BackColor = Card,
            ForeColor = Ink,
            SelectionBackColor = ApplePalette.BlueTint,
            SelectionForeColor = Ink,
            Font = new Font("Segoe UI Variable Text", 9f),
            Padding = new Padding(5, 2, 5, 2),
            NullValue = "—",
            WrapMode = DataGridViewTriState.False,
        };
        _userDirectory.Columns.Add(new DataGridViewTextBoxColumn { Name = "User", HeaderText = "User", FillWeight = 28, MinimumWidth = 140, SortMode = DataGridViewColumnSortMode.Automatic });
        _userDirectory.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "FirebaseUid",
            HeaderText = "Firebase UID",
            FillWeight = 44,
            MinimumWidth = 220,
            SortMode = DataGridViewColumnSortMode.Automatic,
            DefaultCellStyle = new DataGridViewCellStyle { Font = new Font("Cascadia Mono", 8.75f), Padding = new Padding(5, 2, 5, 2), WrapMode = DataGridViewTriState.False },
        });
        _userDirectory.Columns.Add(new DataGridViewTextBoxColumn { Name = "Membership", HeaderText = "Membership", FillWeight = 14, MinimumWidth = 90, SortMode = DataGridViewColumnSortMode.Automatic });
        _userDirectory.Columns.Add(new DataGridViewTextBoxColumn { Name = "Presence", HeaderText = "Presence", FillWeight = 14, MinimumWidth = 80, SortMode = DataGridViewColumnSortMode.Automatic });
        _userDirectory.SelectionChanged += (_, _) => UpdateUserDirectorySelection();
        _userDirectory.CellDoubleClick += async (_, args) =>
        {
            if (args.RowIndex < 0) return;
            _userDirectory.CurrentCell = _userDirectory.Rows[args.RowIndex].Cells[0];
            await CopySelectedUserUidAsync();
        };
        layout.Controls.Add(_userDirectory, 0, 1);

        _userDirectoryCount.Dock = DockStyle.Fill;
        _userDirectoryCount.ForeColor = Muted;
        _userDirectoryCount.Font = new Font("Segoe UI Variable Text", 8.75f);
        _userDirectoryCount.TextAlign = ContentAlignment.MiddleLeft;
        _userDirectoryCount.Text = "Loading Firebase users…";
        layout.Controls.Add(_userDirectoryCount, 0, 2);

        card.Controls.Add(layout);
        return card;
    }

    private Control BuildWebsiteAiRoutingCard()
    {
        var routes = AnalysisAppLogic.GetWebsiteAiProviderRoutes();
        var card = CardPanel(new Padding(22, 12, 22, 12));
        card.Margin = new Padding(0, 8, 0, 8);
        card.AccessibleName = "Website AI routing";
        card.AccessibleDescription = "Read-only provider routing used by the website. Hosted models are never installed through the protected Ollama bridge.";

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = routes.Length + 2,
            BackColor = Card,
            Margin = Padding.Empty,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 27));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
        for (var index = 0; index < routes.Length; index++)
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / routes.Length));

        layout.Controls.Add(CardTitle("Website AI routing"), 0, 0);
        layout.Controls.Add(new Label
        {
            Text = $"{AnalysisAppLogic.WebsiteAiTotalCapacity} concurrent leases · hosted routes are display-only",
            Dock = DockStyle.Fill,
            ForeColor = Muted,
            Font = new Font("Segoe UI Variable Text", 8.75f),
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
        }, 0, 1);

        for (var index = 0; index < routes.Length; index++)
        {
            var route = routes[index];
            var routeRow = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                BackColor = Card,
                Margin = Padding.Empty,
            };
            routeRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
            routeRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
            routeRow.Controls.Add(new Label
            {
                Text = $"{route.DisplayName}  ·  {route.Capacity} slots",
                Dock = DockStyle.Fill,
                ForeColor = Ink,
                Font = new Font("Segoe UI Variable Text", 9f, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true,
                AccessibleName = $"{route.DisplayName} website AI route",
            }, 0, 0);
            routeRow.Controls.Add(new Label
            {
                Text = string.Join("  +  ", route.Models),
                Dock = DockStyle.Fill,
                ForeColor = route.Hosted ? Accent : Muted,
                Font = new Font("Cascadia Mono", 8.5f),
                TextAlign = ContentAlignment.MiddleRight,
                AutoEllipsis = true,
                AccessibleName = $"{route.DisplayName} model",
                AccessibleDescription = route.Hosted
                    ? $"Hosted website model {string.Join(", ", route.Models)}. It is read-only in Analysis and is not an approved local Ollama model."
                    : $"Protected local website profiles use {string.Join(", ", route.Models)}.",
            }, 1, 0);
            layout.Controls.Add(routeRow, 0, index + 2);
        }

        card.Controls.Add(layout);
        return card;
    }

    private Control BuildAiActions()
    {
        _aiActions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = true,
            AutoScroll = false,
            AutoSize = true,
            MinimumSize = new Size(0, 56),
            Margin = new Padding(0, 6, 0, 0),
            Padding = new Padding(0, 6, 0, 0),
            BackColor = Canvas,
        };
        var timeoutLabel = new TableLayoutPanel { Size = new Size(260, 56), RowCount = 2, BackColor = Canvas, Margin = new Padding(0, 0, 10, 0) };
        _aiTimeoutPanel = timeoutLabel;
        timeoutLabel.Controls.Add(new Label { Text = "Auto idle timeout", Dock = DockStyle.Fill, Font = new Font(Font, FontStyle.Bold), TextAlign = ContentAlignment.BottomLeft }, 0, 0);
        _modelActionStatus.Dock = DockStyle.Fill; _modelActionStatus.ForeColor = Muted; _modelActionStatus.Font = new Font("Segoe UI Variable Text", 8.75f); _modelActionStatus.TextAlign = ContentAlignment.TopLeft; _modelActionStatus.AutoEllipsis = true;
        timeoutLabel.Controls.Add(_modelActionStatus, 0, 1);
        _aiActions.Controls.Add(timeoutLabel);
        _idle.DropDownStyle = ComboBoxStyle.DropDownList; _idle.Items.AddRange(["30 minutes", "1 hour", "2 hours", "4 hours"]); _idle.SelectedIndex = 2; _idle.Dock = DockStyle.None; _idle.Width = 176; _idle.Margin = new Padding(0, 11, 14, 10); _idle.AccessibleName = "Auto idle timeout";
        _idle.SelectionChangeCommitted += async (_, _) => await SaveIdleTimeoutAsync();
        _aiActions.Controls.Add(_idle);
        _modelCount.Size = new Size(94, 56); _modelCount.ForeColor = Muted; _modelCount.TextAlign = ContentAlignment.MiddleLeft; _modelCount.Margin = new Padding(0, 0, 8, 0); _aiActions.Controls.Add(_modelCount);
        _fastModelButton = ModernButton("Install Fast", () => InstallApprovedModelAsync(ApprovedOllamaModelProfile.Fast), 112);
        _fastModelButton.Dock = DockStyle.None; _fastModelButton.Size = new Size(112, 36); _fastModelButton.Margin = new Padding(0, 10, 10, 10);
        _fastModelButton.AccessibleDescription = $"Install or verify the approved Fast model {AnalysisAppLogic.ApprovedFastModel}";
        _aiActions.Controls.Add(_fastModelButton);
        _smartModelButton = ModernButton("Install Smart", () => InstallApprovedModelAsync(ApprovedOllamaModelProfile.Smart), 120);
        _smartModelButton.Dock = DockStyle.None; _smartModelButton.Size = new Size(120, 36); _smartModelButton.Margin = new Padding(0, 10, 10, 10);
        _smartModelButton.AccessibleDescription = $"Install or verify the approved Smart model {AnalysisAppLogic.ApprovedSmartModel}";
        _aiActions.Controls.Add(_smartModelButton);
        _visionModelButton = ModernButton("Install Vision", () => InstallApprovedModelAsync(ApprovedOllamaModelProfile.Vision), 122);
        _visionModelButton.Dock = DockStyle.None; _visionModelButton.Size = new Size(122, 36); _visionModelButton.Margin = new Padding(0, 10, 10, 10);
        _visionModelButton.AccessibleDescription = $"Install or verify the approved Vision model {AnalysisAppLogic.ApprovedVisionModel}";
        _aiActions.Controls.Add(_visionModelButton);
        var verified = new Label { Text = "Allowlisted only", Size = new Size(96, 56), ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 8.75f), TextAlign = ContentAlignment.MiddleRight, Margin = Padding.Empty };
        _aiActions.Controls.Add(verified);
        return _aiActions;
    }

    private Control BuildBridgeActionRow()
    {
        _bridgeActions = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, MinimumSize = new Size(0, 52), FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Padding = new Padding(0, 12, 0, 0), BackColor = Canvas };
        _bridgeActions.Controls.Add(ModernButton("Start bridge", async () => await RunActionAsync("start-bridge"), 130));
        _bridgeActions.Controls.Add(ModernButton("Restart bridge", async () => await RunActionAsync("restart-bridge"), 140));
        _bridgeActions.Controls.Add(ModernButton("Stop bridge", async () => await RunActionAsync("stop-bridge"), 130));
        _tunnelToggleButton = ModernButton("Turn tunnel on", ToggleTunnelAsync, 150);
        _tunnelToggleButton.AccessibleDescription = "Public tunnel status is loading. Press to turn the tunnel on after confirmation.";
        _bridgeActions.Controls.Add(_tunnelToggleButton);
        _bridgeActions.Controls.Add(ModernButton("Open logs", OpenLogsAsync, 120));
        _bridgeActions.Controls.Add(ModernButton("Choose workspace", ChooseWorkspaceAsync, 150));
        return _bridgeActions;
    }

    private Control ChartCard(string title, string subtitle, Control chart)
    {
        var card = CardPanel(new Padding(20));
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(CardTitle(title), 0, 0);
        layout.Controls.Add(new Label { Text = subtitle, Dock = DockStyle.Fill, ForeColor = Muted }, 0, 1);
        chart.Dock = DockStyle.Fill; layout.Controls.Add(chart, 0, 2); card.Controls.Add(layout); return card;
    }

    private Control MetricCard(string key, string title, string note)
    {
        var card = CardPanel(new Padding(18, 12, 18, 10)); card.Margin = new Padding(0, 0, 12, 0);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        layout.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 9f, FontStyle.Regular) }, 0, 0);
        var value = new Label { Text = "—", Dock = DockStyle.Fill, Font = new Font("Segoe UI Variable Display", 24, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft };
        Register(_metricValues, key, value); layout.Controls.Add(value, 0, 1);
        layout.Controls.Add(new Label { Text = note, Dock = DockStyle.Fill, ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 8.75f) }, 0, 2);
        card.Controls.Add(layout); return card;
    }

    private Control MetricBlock(string key, string title, string note, bool divider)
    {
        _ = note;
        var block = new Panel { Dock = DockStyle.Fill, BackColor = Card, Padding = new Padding(20, 12, 18, 10), Margin = new Padding(0) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, BackColor = Card };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(new Label { Text = title, Dock = DockStyle.Top, AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 9.5f) }, 0, 0);
        var value = new Label { Text = "—", Dock = DockStyle.Fill, Font = new Font("Segoe UI Variable Display", 26, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft };
        Register(_metricValues, key, value);
        layout.Controls.Add(value, 0, 1);
        block.Controls.Add(layout);
        block.Tag = divider;
        block.Paint += (_, e) =>
        {
            if (block.Tag is not true) return;
            using var pen = new Pen(Border);
            e.Graphics.DrawLine(pen, block.Width - 1, 16, block.Width - 1, Math.Max(16, block.Height - 16));
        };
        return block;
    }

    private Control InfoCard(string title, string copy)
    {
        var card = new Panel { Dock = DockStyle.Fill, AutoSize = true, MinimumSize = new Size(0, 112), BackColor = Canvas, Padding = new Padding(20, 14, 20, 14), Margin = Padding.Empty };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, RowCount = 2, BackColor = Canvas };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(CardTitle(title), 0, 0);
        layout.Controls.Add(new Label { Text = copy, Dock = DockStyle.Top, AutoSize = true, ForeColor = Muted, MaximumSize = new Size(300, 0), Padding = new Padding(0, 8, 0, 0) }, 0, 1);
        card.Controls.Add(layout); return card;
    }

    private Panel PagePanel()
    {
        var page = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(34, 18, 34, 14), BackColor = Canvas };
        page.HorizontalScroll.Enabled = false;
        _responsivePages.Add(page);
        return page;
    }

    private static Panel CardPanel(Padding padding)
    {
        var panel = new AppleSurface { Dock = DockStyle.Fill, BackColor = Card, Padding = padding, Margin = Padding.Empty, CornerRadius = 16, StrokeColor = Border };
        return panel;
    }

    private static Label CardTitle(string text) => new() { Text = text, Dock = DockStyle.Fill, Font = new Font("Segoe UI Variable Display", 13f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft };
    private static Label MutedLabel(string text) => new() { Text = text, Dock = DockStyle.Fill, ForeColor = Muted, TextAlign = ContentAlignment.BottomLeft };

    private Control PageIntro(string title, string subtitle)
    {
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 82), RowCount = 2, Margin = new Padding(0, 0, 0, 8), BackColor = Canvas };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label { Text = title, Dock = DockStyle.Top, AutoSize = true, Font = new Font("Segoe UI Variable Display", 22, FontStyle.Bold), TextAlign = ContentAlignment.BottomLeft }, 0, 0);
        layout.Controls.Add(new Label { Text = subtitle, Dock = DockStyle.Top, AutoSize = true, AutoEllipsis = true, ForeColor = Muted, Font = new Font("Segoe UI Variable Text", 9.75f), TextAlign = ContentAlignment.TopLeft, Padding = new Padding(0, 5, 0, 0) }, 0, 1);
        _pageIntros.Add(layout);
        return layout;
    }

    private static Control SummaryBlock(string title, Label value)
    {
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, Padding = new Padding(24, 14, 4, 8), BackColor = Card };
        layout.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, ForeColor = Muted }, 0, 0);
        value.Dock = DockStyle.Fill; value.Font = new Font("Segoe UI Variable Display", 16, FontStyle.Bold); layout.Controls.Add(value, 0, 1); return layout;
    }

    private AppleActionButton ModernButton(string text, Func<Task> action, int width)
    {
        var button = new AppleActionButton { Text = text, Caption = text, Width = width, Height = 36, BackColor = Card, ForeColor = Ink, Font = new Font("Segoe UI Variable Text", 9.25f, FontStyle.Bold), Margin = new Padding(0, 0, 10, 0), CornerRadius = 10, BorderColor = Border };
        button.Click += async (_, _) => await action();
        _actionButtons.Add(button);
        return button;
    }

    private AppleActionButton ConsoleButton(string text, Func<Task> action, int width, bool primary = false)
    {
        var button = new AppleActionButton
        {
            Text = text,
            Caption = text,
            Width = width,
            Height = 34,
            BackColor = primary ? ApplePalette.BlueFill : ApplePalette.ConsoleRaised,
            ForeColor = primary ? Color.White : Color.FromArgb(226, 226, 232),
            Font = new Font("Segoe UI Variable Text", 8.75f, FontStyle.Bold),
            Margin = new Padding(0, 0, 6, 0),
            CornerRadius = 9,
            BorderColor = primary ? ApplePalette.BlueFill : Color.FromArgb(72, 73, 82),
        };
        button.Click += async (_, _) => await action();
        return button;
    }

    private Button ModeButton(string text, string mode)
    {
        var button = new AppleButton { Text = text, Tag = mode, Dock = DockStyle.Fill, BackColor = Card, Font = new Font("Segoe UI Variable Text", 9.5f, FontStyle.Bold), Margin = Padding.Empty, CornerRadius = 9 };
        button.FlatAppearance.BorderSize = 0;
        button.Click += async (_, _) => await SetModeAsync(mode);
        return button;
    }

    private void RegisterAdaptiveGrid(
        TableLayoutPanel panel,
        Control[] items,
        int compactColumns,
        int standardColumns,
        int wideColumns,
        float[]? compactRowWeights = null,
        float[]? compactColumnWeights = null,
        float[]? standardColumnWeights = null,
        float[]? wideColumnWeights = null,
        bool updateRowDividers = false)
    {
        _adaptiveGrids.Add(new AdaptiveGridBinding(
            panel,
            items,
            compactColumns,
            standardColumns,
            wideColumns,
            compactRowWeights,
            compactColumnWeights,
            standardColumnWeights,
            wideColumnWeights,
            updateRowDividers));
    }

    private void ApplyResponsiveLayout(bool force = false)
    {
        var dpi = Math.Max(96, DeviceDpi);
        var logicalWidth = (int)Math.Round(ClientSize.Width * 96f / dpi);
        var logicalHeight = (int)Math.Round(ClientSize.Height * 96f / dpi);
        var widthClass = AnalysisAppLogic.ClassifyWindowWidth(logicalWidth);
        var shortWindow = AnalysisAppLogic.IsShortWindowHeight(logicalHeight);

        UpdateBottomNavigationWidth();
        if (!force && _appliedWindowWidthClass == widthClass && _appliedShortWindow == shortWindow)
        {
            UpdateResponsivePagePadding(logicalWidth, shortWindow);
            return;
        }

        _appliedWindowWidthClass = widthClass;
        _appliedShortWindow = shortWindow;

        SuspendLayout();
        _shellLayout?.SuspendLayout();
        _headerLayout?.SuspendLayout();
        _pageHost.SuspendLayout();
        try
        {
            foreach (var binding in _adaptiveGrids) ApplyAdaptiveGrid(binding, widthClass);

            UpdateResponsivePagePadding(logicalWidth, shortWindow);

            SetAbsoluteRows(_shellLayout, null, null, shortWindow ? 56 : 64);
            SetAutoRows(_shellLayout, 0);

            if (_headerLayout is not null)
            {
                var headerMetrics = widthClass switch
                {
                    AnalysisWindowWidthClass.Compact => new { Padding = new Padding(18, 5, 18, 5), Mark = 44, Refresh = 100, Main = shortWindow ? 42 : 46 },
                    AnalysisWindowWidthClass.Standard => new { Padding = new Padding(24, 6, 24, 6), Mark = 46, Refresh = 104, Main = shortWindow ? 44 : 48 },
                    _ => new { Padding = new Padding(34, 7, 34, 7), Mark = 48, Refresh = 106, Main = shortWindow ? 44 : 48 },
                };
                _headerLayout.Padding = ScalePadding(headerMetrics.Padding);
                SetHeaderColumns(_headerLayout, headerMetrics.Mark, headerMetrics.Refresh);
                ArrangeHeaderControls(_headerLayout, widthClass, headerMetrics.Main, headerMetrics.Mark);
                _refreshButton.Margin = ScalePadding(widthClass switch
                {
                    AnalysisWindowWidthClass.Compact => new Padding(6, 5, 0, 5),
                    AnalysisWindowWidthClass.Standard => new Padding(8, 6, 0, 6),
                    _ => new Padding(8, 6, 0, 6),
                });
            }

            if (_bottomNavigationLayout is not null)
            {
                _bottomNavigationLayout.Padding = ScalePadding(widthClass == AnalysisWindowWidthClass.Compact
                    ? new Padding(10, 4, 10, 4)
                    : new Padding(16, 4, 16, 4));
            }

            switch (widthClass)
            {
                case AnalysisWindowWidthClass.Compact:
                    SetAbsoluteRows(_overviewLayout, null, 210, 500, 390);
                    SetAbsoluteRows(_usersLayout, null, 210, 580, null);
                    SetAbsoluteRows(_aiLayout, null, 156, 440, 184, 176, null);
                    SetAbsoluteRows(_healthLayout, null, 260, 268, null);
                    break;
                case AnalysisWindowWidthClass.Standard:
                    SetAbsoluteRows(_overviewLayout, null, 116, 265, 230);
                    SetAbsoluteRows(_usersLayout, null, 116, 350, null);
                    SetAbsoluteRows(_aiLayout, null, 140, 235, 170, 158, null);
                    SetAbsoluteRows(_healthLayout, null, 260, 268, null);
                    break;
                default:
                    SetAbsoluteRows(_overviewLayout, null, 116, 255, 220);
                    SetAbsoluteRows(_usersLayout, null, 116, 330, null);
                    SetAbsoluteRows(_aiLayout, null, 140, 218, 164, 148, null);
                    SetAbsoluteRows(_healthLayout, null, 260, 268, null);
                    break;
            }

            SetAutoRows(_overviewLayout, 0);
            SetAutoRows(_usersLayout, 0, 3);
            SetAutoRows(_aiLayout, 0, 5);
            SetAutoRows(_healthLayout, 0, 3);

            SetAbsoluteRows(_consoleLayout, null, null, null);
            SetAutoRows(_consoleLayout, 0, 2);
            foreach (var intro in _pageIntros)
            {
                intro.MinimumSize = new Size(0, ScaleLogical(shortWindow ? 70 : 82));
                if (intro is TableLayoutPanel introLayout && introLayout.Controls.Count > 0 && introLayout.Controls[0] is Label introTitle)
                {
                    var titleSize = shortWindow ? 20f : 22f;
                    if (Math.Abs(introTitle.Font.Size - titleSize) > 0.1f)
                        introTitle.Font = new Font("Segoe UI Variable Display", titleSize, FontStyle.Bold);
                }
            }
            var metricSize = widthClass == AnalysisWindowWidthClass.Compact ? 24f : 26f;
            foreach (var labels in _metricValues.Values)
            {
                foreach (var label in labels)
                {
                    if (Math.Abs(label.Font.Size - metricSize) > 0.1f)
                        label.Font = new Font("Segoe UI Variable Display", metricSize, FontStyle.Bold);
                }
            }
            var summarySize = widthClass == AnalysisWindowWidthClass.Compact ? 14f : 16f;
            if (Math.Abs(_modeValue.Font.Size - summarySize) > 0.1f)
                _modeValue.Font = new Font("Segoe UI Variable Display", summarySize, FontStyle.Bold);
            if (Math.Abs(_checkedValue.Font.Size - summarySize) > 0.1f)
                _checkedValue.Font = new Font("Segoe UI Variable Display", summarySize, FontStyle.Bold);
            if (_aiTimeoutPanel is not null)
            {
                _aiTimeoutPanel.Width = ScaleLogical(widthClass switch
                {
                    AnalysisWindowWidthClass.Compact => 230,
                    AnalysisWindowWidthClass.Standard => 250,
                    _ => 260,
                });
            }
            if (_aiActions is not null) _aiActions.Padding = ScalePadding(new Padding(0, shortWindow ? 4 : 6, 0, 0));
            if (_bridgeActions is not null) _bridgeActions.Padding = ScalePadding(new Padding(0, widthClass == AnalysisWindowWidthClass.Compact ? 8 : 12, 0, 0));

            UpdateBottomNavigationWidth();
            UpdateWarningBanner();
            _overviewGrowth.Invalidate();
            _usersGrowth.Invalidate();
            _activityChart.Invalidate();
        }
        finally
        {
            _pageHost.ResumeLayout(true);
            _headerLayout?.ResumeLayout(true);
            _shellLayout?.ResumeLayout(true);
            ResumeLayout(true);
        }
    }

    private void ApplyAdaptiveGrid(AdaptiveGridBinding binding, AnalysisWindowWidthClass widthClass)
    {
        var columns = widthClass switch
        {
            AnalysisWindowWidthClass.Compact => binding.CompactColumns,
            AnalysisWindowWidthClass.Standard => binding.StandardColumns,
            _ => binding.WideColumns,
        };
        columns = Math.Max(1, columns);
        var rows = Math.Max(1, (int)Math.Ceiling(binding.Items.Length / (double)columns));
        var columnWeights = widthClass switch
        {
            AnalysisWindowWidthClass.Compact => binding.CompactColumnWeights,
            AnalysisWindowWidthClass.Standard => binding.StandardColumnWeights,
            _ => binding.WideColumnWeights,
        };
        var rowWeights = widthClass == AnalysisWindowWidthClass.Compact ? binding.CompactRowWeights : null;

        binding.Panel.SuspendLayout();
        try
        {
            binding.Panel.Controls.Clear();
            binding.Panel.ColumnStyles.Clear();
            binding.Panel.RowStyles.Clear();
            binding.Panel.ColumnCount = columns;
            binding.Panel.RowCount = rows;
            binding.Panel.GrowStyle = TableLayoutPanelGrowStyle.FixedSize;

            for (var column = 0; column < columns; column++)
            {
                var weight = columnWeights is { Length: > 0 } && columnWeights.Length == columns ? columnWeights[column] : 100f / columns;
                binding.Panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, weight));
            }
            for (var row = 0; row < rows; row++)
            {
                var weight = rowWeights is { Length: > 0 } && rowWeights.Length == rows ? rowWeights[row] : 100f / rows;
                binding.Panel.RowStyles.Add(new RowStyle(SizeType.Percent, weight));
            }

            for (var index = 0; index < binding.Items.Length; index++)
            {
                var item = binding.Items[index];
                var column = index % columns;
                var row = index / columns;
                item.Dock = DockStyle.Fill;
                if (binding.UpdateRowDividers)
                {
                    item.Tag = column < columns - 1;
                    item.Margin = Padding.Empty;
                    item.Invalidate();
                }
                else
                {
                    item.Margin = ScalePadding(new Padding(
                        column == 0 ? 0 : 6,
                        row == 0 ? 0 : 6,
                        column == columns - 1 ? 0 : 6,
                        row == rows - 1 ? 0 : 6));
                }
                binding.Panel.Controls.Add(item, column, row);
            }
        }
        finally
        {
            binding.Panel.ResumeLayout(true);
        }
    }

    private void UpdateBottomNavigationWidth()
    {
        if (_bottomNavigationLayout is null || _bottomNavigationLayout.ColumnStyles.Count < 3) return;
        var dpi = Math.Max(96, DeviceDpi);
        var logicalWidth = (int)Math.Round(ClientSize.Width * 96f / dpi);
        var widthClass = AnalysisAppLogic.ClassifyWindowWidth(logicalWidth);
        var availableWidth = Math.Max(0, _bottomNavigationLayout.ClientSize.Width - _bottomNavigationLayout.Padding.Horizontal);
        var desiredWidth = ScaleLogical(widthClass switch
        {
            AnalysisWindowWidthClass.Compact => 600,
            AnalysisWindowWidthClass.Standard => 640,
            _ => 680,
        });
        _bottomNavigationLayout.ColumnStyles[1].Width = Math.Min(desiredWidth, availableWidth);
    }

    private void UpdateWarningBanner()
    {
        if (_warningBanner is null || _headerLayout is null) return;
        var visible = !string.IsNullOrWhiteSpace(_warning.Text);
        var availableWidth = Math.Max(
            ScaleLogical(260),
            _headerLayout.ClientSize.Width
            - _headerLayout.Padding.Horizontal
            - _warningBanner.Margin.Horizontal
            - _warningBanner.Padding.Horizontal);
        var maximumSize = new Size(availableWidth, 0);
        var changed = _warningBanner.Visible != visible || _warning.MaximumSize != maximumSize;
        _warning.MaximumSize = maximumSize;
        _warningBanner.Visible = visible;
        if (!changed) return;
        _warningBanner.PerformLayout();
        _headerLayout.PerformLayout();
        _shellLayout?.PerformLayout();
    }

    private void UpdateResponsivePagePadding(int logicalWidth, bool shortWindow)
    {
        var horizontal = ScaleLogical(AnalysisAppLogic.CalculatePageHorizontalPadding(logicalWidth));
        var top = ScaleLogical(shortWindow ? 10 : 16);
        var bottom = ScaleLogical(shortWindow ? 10 : 14);
        var pagePadding = new Padding(horizontal, top, horizontal, bottom);
        foreach (var page in _responsivePages)
        {
            if (page.Padding != pagePadding) page.Padding = pagePadding;
        }

        var contentWidth = Math.Max(ScaleLogical(320), ClientSize.Width - (horizontal * 2));
        if (_aiActions is not null) _aiActions.MaximumSize = new Size(contentWidth, 0);
        if (_bridgeActions is not null) _bridgeActions.MaximumSize = new Size(contentWidth, 0);

        if (_consolePage is null) return;
        var consolePadding = new Padding(horizontal, top, horizontal, ScaleLogical(shortWindow ? 8 : 12));
        if (_consolePage.Padding != consolePadding) _consolePage.Padding = consolePadding;
    }

    private void SetAbsoluteRows(TableLayoutPanel? panel, params float?[] heights)
    {
        if (panel is null) return;
        while (panel.RowStyles.Count < heights.Length) panel.RowStyles.Add(new RowStyle());
        for (var index = 0; index < heights.Length; index++)
        {
            if (heights[index] is { } height)
            {
                panel.RowStyles[index].SizeType = SizeType.Absolute;
                panel.RowStyles[index].Height = ScaleLogical(height);
            }
            else
            {
                panel.RowStyles[index].SizeType = SizeType.Percent;
                panel.RowStyles[index].Height = 100;
            }
        }
    }

    private static void SetAutoRows(TableLayoutPanel? panel, params int[] indices)
    {
        if (panel is null) return;
        foreach (var index in indices)
        {
            while (panel.RowStyles.Count <= index) panel.RowStyles.Add(new RowStyle());
            panel.RowStyles[index].SizeType = SizeType.AutoSize;
            panel.RowStyles[index].Height = 0;
        }
    }

    private void SetHeaderColumns(TableLayoutPanel panel, float markWidth, float refreshWidth)
    {
        var widthClass = _appliedWindowWidthClass ?? AnalysisWindowWidthClass.Wide;
        var stacked = AnalysisAppLogic.ShouldStackHeaderActions(widthClass);
        var remoteSessionWidth = _remoteSessionButton.Visible ? 100f : 0f;
        while (panel.ColumnStyles.Count < 6) panel.ColumnStyles.Add(new ColumnStyle());
        panel.ColumnStyles[0].SizeType = SizeType.Absolute;
        panel.ColumnStyles[0].Width = ScaleLogical(markWidth);
        panel.ColumnStyles[1].SizeType = SizeType.Percent;
        panel.ColumnStyles[1].Width = 100;
        panel.ColumnStyles[2].SizeType = SizeType.Absolute;
        panel.ColumnStyles[2].Width = ScaleLogical(stacked ? 0 : 146);
        panel.ColumnStyles[3].SizeType = SizeType.Absolute;
        panel.ColumnStyles[3].Width = ScaleLogical(stacked ? 0 : remoteSessionWidth);
        panel.ColumnStyles[4].SizeType = SizeType.Absolute;
        panel.ColumnStyles[4].Width = ScaleLogical(200);
        panel.ColumnStyles[5].SizeType = SizeType.Absolute;
        panel.ColumnStyles[5].Width = ScaleLogical(refreshWidth);
    }

    private void ArrangeHeaderControls(
        TableLayoutPanel panel,
        AnalysisWindowWidthClass widthClass,
        float mainHeight,
        float markWidth)
    {
        var stacked = AnalysisAppLogic.ShouldStackHeaderActions(widthClass);

        if (stacked)
        {
            panel.SetCellPosition(_connectionSelector, new TableLayoutPanelCellPosition(4, 1));
            panel.SetCellPosition(_remoteSessionButton, new TableLayoutPanelCellPosition(5, 1));
            panel.SetCellPosition(_liveStatus, new TableLayoutPanelCellPosition(4, 0));
            panel.SetCellPosition(_refreshButton, new TableLayoutPanelCellPosition(5, 0));
            panel.SetCellPosition(_pageTitle, new TableLayoutPanelCellPosition(1, 0));
            panel.SetColumnSpan(_pageTitle, 3);
            if (_warningBanner is not null)
            {
                panel.SetCellPosition(_warningBanner, new TableLayoutPanelCellPosition(0, 2));
                panel.SetColumnSpan(_warningBanner, 6);
            }

            SetAbsoluteRows(panel, mainHeight, 40, 0);
            SetAutoRows(panel, 2);
            _connectionSelector.Margin = ScalePadding(new Padding(8, 5, 6, 5));
            _remoteSessionButton.Margin = ScalePadding(new Padding(4, 4, 0, 4));
        }
        else
        {
            panel.SetCellPosition(_connectionSelector, new TableLayoutPanelCellPosition(2, 0));
            panel.SetCellPosition(_remoteSessionButton, new TableLayoutPanelCellPosition(3, 0));
            panel.SetCellPosition(_liveStatus, new TableLayoutPanelCellPosition(4, 0));
            panel.SetCellPosition(_refreshButton, new TableLayoutPanelCellPosition(5, 0));
            panel.SetCellPosition(_pageTitle, new TableLayoutPanelCellPosition(1, 0));
            panel.SetColumnSpan(_pageTitle, 1);
            if (_warningBanner is not null)
            {
                panel.SetCellPosition(_warningBanner, new TableLayoutPanelCellPosition(0, 1));
                panel.SetColumnSpan(_warningBanner, 6);
            }

            SetAbsoluteRows(panel, mainHeight, 0, 0);
            SetAutoRows(panel, 1);
            _connectionSelector.Margin = ScalePadding(new Padding(8, 7, 6, 7));
            _remoteSessionButton.Margin = ScalePadding(new Padding(4, 6, 0, 6));
        }

        _liveStatus.Padding = ScalePadding(new Padding(stacked ? 8 : 10, 0, stacked ? 8 : 10, 0));
        if (_warningBanner is not null)
            _warningBanner.Margin = ScalePadding(new Padding((int)markWidth, 4, 0, 1));
    }

    private void SetAbsoluteColumns(TableLayoutPanel panel, params float?[] widths)
    {
        while (panel.ColumnStyles.Count < widths.Length) panel.ColumnStyles.Add(new ColumnStyle());
        for (var index = 0; index < widths.Length; index++)
        {
            if (widths[index] is { } width)
            {
                panel.ColumnStyles[index].SizeType = SizeType.Absolute;
                panel.ColumnStyles[index].Width = ScaleLogical(width);
            }
            else
            {
                panel.ColumnStyles[index].SizeType = SizeType.Percent;
                panel.ColumnStyles[index].Width = 100;
            }
        }
    }

    private int ScaleLogical(float value) => (int)Math.Round(value * Math.Max(96, DeviceDpi) / 96f);

    private Padding ScalePadding(Padding padding) => new(
        ScaleLogical(padding.Left),
        ScaleLogical(padding.Top),
        ScaleLogical(padding.Right),
        ScaleLogical(padding.Bottom));

    private void AddPage(string name, Control page)
    {
        page.Visible = false;
        _pages[name] = page;
        _pageHost.Controls.Add(page);
    }

    private void ShowPage(string name)
    {
        if (_connectionMode == AnalysisConnectionMode.Remote && name is "Users" or "Console")
            name = "Overview";
        foreach (var entry in _pages) entry.Value.Visible = string.Equals(entry.Key, name, StringComparison.OrdinalIgnoreCase);
        foreach (var entry in _navButtons)
        {
            var active = string.Equals(entry.Key, name, StringComparison.OrdinalIgnoreCase);
            entry.Value.Selected = active;
            entry.Value.AccessibleDescription = active ? "Selected tab" : "Tab";
        }
        _activePageKey = name;
        _pages[name].BringToFront();
        if (string.Equals(name, "Console", StringComparison.OrdinalIgnoreCase)) _consoleInput.Focus();
    }

    private async Task ChangeConnectionModeAsync()
    {
        var requested = _connectionSelector.SelectedIndex == 1
            ? AnalysisConnectionMode.Remote
            : AnalysisConnectionMode.Local;
        if (requested == _connectionMode) return;

        _connectionMode = requested;
        _lastSnapshot = null;
        if (_connectionMode == AnalysisConnectionMode.Remote)
        {
            _platformSnapshot = new PlatformSnapshot(0, 0, 0, 0, 0, [], [], DateTime.Now, null);
            ApplySnapshot(RemotePlaceholder("Remote sign-in is required."));
            ShowPage("Overview");
            AppendConsole("Remote desktop selected. Local administrator controls are disabled.");
            ApplyConnectionModeRestrictions();
            if (_remoteClient.HasStoredSession)
                await RefreshAsync(includePlatform: false);
            else
                await SignInRemoteAsync();
        }
        else
        {
            AppendConsole("This PC selected. Local administrator controls are available after refresh.");
            ApplyConnectionModeRestrictions();
            await RefreshAsync(includePlatform: true);
        }
    }

    private async Task ToggleRemoteSessionAsync()
    {
        if (_connectionMode != AnalysisConnectionMode.Remote) return;
        if (_remoteClient.HasStoredSession)
        {
            _remoteClient.SignOut();
            _lastSnapshot = null;
            ApplySnapshot(RemotePlaceholder("Signed out of the remote desktop."));
            AppendConsole("Remote Cloudflare Access session removed from this Windows user account.");
            ApplyConnectionModeRestrictions();
            return;
        }
        await SignInRemoteAsync();
    }

    private async Task SignInRemoteAsync()
    {
        if (_connectionMode != AnalysisConnectionMode.Remote || _busy) return;
        SetBusy(true);
        _liveStatus.Text = "SIGNING IN  •  REMOTE";
        try
        {
            await _remoteClient.SignInAsync(_lifetimeCancellation.Token);
            AppendConsole("Remote Cloudflare Access sign-in completed.");
        }
        catch (OperationCanceledException) when (_lifetimeCancellation.IsCancellationRequested) { return; }
        catch (Exception error)
        {
            ApplySnapshot(RemotePlaceholder(error.Message));
            AppendConsole($"Remote sign-in failed: {error.Message}");
            MessageBox.Show(error.Message, "Remote Analysis sign-in", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        finally { SetBusy(false); }
        await RefreshAsync(includePlatform: false);
    }

    private AnalysisSnapshot RemotePlaceholder(string warning)
        => new(
            OllamaReady: false,
            BridgeReady: false,
            TunnelReady: false,
            TunnelDesiredOn: false,
            RecoveryTask: new RecoveryTaskSnapshot(
                AnalysisAppLogic.PublicGatewayRecoveryTaskName,
                Installed: null,
                Enabled: false,
                RecoveryTaskSchedulerState.Unknown,
                LastTaskResult: null,
                LastRunTime: null,
                Error: null),
            PublicUrl: _remoteClient.Resource.AbsoluteUri.TrimEnd('/'),
            Mode: "auto",
            IdleMinutes: 120,
            Models: [],
            ModelsChecked: false,
            LastActivity: null,
            Activity: [],
            Platform: new PlatformSnapshot(0, 0, 0, 0, 0, [], [], DateTime.Now, null),
            Warning: warning,
            ConnectionMode: AnalysisConnectionMode.Remote);

    private async Task InitializeAsync()
    {
        if (_initialLoadStarted) return;
        _initialLoadStarted = true;
        _initializing = true;
        _shellLayout!.Enabled = false;
        _startupLoadingScreen.Visible = true;
        _startupLoadingScreen.SetStage(StartupLoadStage.Preparing);
        _startupLoadingScreen.BringToFront();
        var minimumDisplay = Stopwatch.StartNew();

        // Let Windows paint the loading screen before any asynchronous service work resumes.
        await Task.Yield();
        try
        {
            await RefreshAsync(
                includePlatform: true,
                startupProgress: stage => _startupLoadingScreen.SetStage(stage));
        }
        catch (OperationCanceledException) when (_lifetimeCancellation.IsCancellationRequested)
        {
            return;
        }
        catch (Exception error)
        {
            _warning.Text = error.Message;
            _liveStatus.Text = "STARTUP FAILED";
            _liveStatus.ForeColor = Warning;
            AppendConsole($"Startup failed: {error.Message}");
        }

        if (_lifetimeCancellation.IsCancellationRequested || _closeRequested) return;
        var remaining = TimeSpan.FromMilliseconds(450) - minimumDisplay.Elapsed;
        if (remaining > TimeSpan.Zero)
        {
            try { await Task.Delay(remaining, _lifetimeCancellation.Token); }
            catch (OperationCanceledException) { return; }
        }

        _startupLoadingScreen.SetStage(StartupLoadStage.Ready);
        try { await Task.Delay(140, _lifetimeCancellation.Token); }
        catch (OperationCanceledException) { return; }
        if (_lifetimeCancellation.IsCancellationRequested || _closeRequested) return;

        _initializing = false;
        _startupLoadingScreen.Visible = false;
        _shellLayout.Enabled = true;
        ApplyConnectionModeRestrictions();
        _liveTimer.Start();
    }

    private async Task RefreshAsync(
        bool includePlatform = true,
        bool automatic = false,
        Action<StartupLoadStage>? startupProgress = null)
    {
        if (_lifetimeCancellation.IsCancellationRequested || _refreshing || (automatic && _busy)) return;
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _refreshCompletion = completion;
        _refreshing = true;
        _refreshButton.Enabled = false;
        _connectionSelector.Enabled = false;
        if (!automatic) UseWaitCursor = true;
        _liveStatus.Text = _connectionMode == AnalysisConnectionMode.Remote
            ? "UPDATING  •  REMOTE"
            : "UPDATING  •  LOCAL";
        startupProgress?.Invoke(_connectionMode == AnalysisConnectionMode.Remote
            ? StartupLoadStage.RemoteDesktop
            : StartupLoadStage.ProtectedServices);
        try
        {
            var cancellationToken = _lifetimeCancellation.Token;
            if (_connectionMode == AnalysisConnectionMode.Remote)
            {
                var remoteSnapshot = await _remoteClient.LoadSnapshotAsync(cancellationToken);
                if (_connectionMode != AnalysisConnectionMode.Remote) return;
                _lastSnapshot = remoteSnapshot;
                ApplySnapshot(remoteSnapshot);
                return;
            }

            var platformTask = includePlatform ? _client.LoadPlatformAsync(cancellationToken) : null;
            var snapshot = await _client.LoadLocalAsync(_platformSnapshot, cancellationToken);
            if (_connectionMode != AnalysisConnectionMode.Local) return;
            _lastSnapshot = snapshot;
            ApplySnapshot(snapshot);

            if (platformTask is not null)
            {
                _liveStatus.Text = "UPDATING  •  ANALYTICS";
                startupProgress?.Invoke(StartupLoadStage.PlatformAnalytics);
                var refreshedPlatform = await platformTask;
                _platformSnapshot = refreshedPlatform.Growth.Length == 0 && _platformSnapshot.Growth.Length > 0
                    ? _platformSnapshot with
                    {
                        Warning = $"Showing the last successful Firebase snapshot. {refreshedPlatform.Warning}".Trim(),
                    }
                    : refreshedPlatform;
                _lastPlatformRefresh = DateTime.Now;
                snapshot = snapshot with { Platform = _platformSnapshot };
                _lastSnapshot = snapshot;
                ApplySnapshot(snapshot);
            }
        }
        catch (OperationCanceledException) when (_lifetimeCancellation.IsCancellationRequested)
        {
            // Form shutdown waits for this path so temporary Firebase exports
            // and child processes finish their cancellation cleanup.
        }
        catch (Exception error)
        {
            _warning.Text = error.Message;
            _liveStatus.Text = _connectionMode == AnalysisConnectionMode.Remote
                ? "REMOTE UNAVAILABLE"
                : "UPDATE FAILED";
            _liveStatus.ForeColor = Warning;
            AppendConsole($"Refresh failed: {error.Message}");
        }
        finally
        {
            _refreshing = false;
            UseWaitCursor = _busy;
            _refreshButton.Enabled = !_busy;
            ApplyConnectionModeRestrictions();
            completion.TrySetResult(true);
            if (ReferenceEquals(_refreshCompletion, completion)) _refreshCompletion = null;
        }
    }

    private async Task CloseGracefullyAsync(FormClosingEventArgs args)
    {
        if (_closeReady) return;
        args.Cancel = true;
        if (_closeRequested) return;
        _closeRequested = true;
        _liveTimer.Stop();
        _lifetimeCancellation.Cancel();
        _modelInstallCancellation?.Cancel();

        var refresh = _refreshCompletion?.Task;
        if (refresh is not null)
        {
            try { await refresh; }
            catch (OperationCanceledException) { }
        }

        _closeReady = true;
        if (IsHandleCreated && !IsDisposed) BeginInvoke(Close);
    }

    private void ApplySnapshot(AnalysisSnapshot snapshot)
    {
        var isRemote = snapshot.ConnectionMode == AnalysisConnectionMode.Remote;
        var warnings = new[] { snapshot.Warning, snapshot.Platform.Warning }
            .Where(message => !string.IsNullOrWhiteSpace(message))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        _warning.Text = string.Join("  •  ", warnings);

        var analyticsAvailable = snapshot.Platform.Growth.Length > 0;
        SetMetric("total", analyticsAvailable ? snapshot.Platform.TotalUsers.ToString("N0") : "—");
        SetMetric("active", analyticsAvailable ? snapshot.Platform.ActiveUsers.ToString("N0") : "—");
        SetMetric("paid", analyticsAvailable ? snapshot.Platform.PaidMemberships.ToString("N0") : "—");
        SetMetric("new", analyticsAvailable ? snapshot.Platform.NewUsers30Days.ToString("N0") : "—");
        _overviewGrowth.SetGrowth(snapshot.Platform.Growth);
        _usersGrowth.SetGrowth(snapshot.Platform.Growth);
        _activityChart.SetActivity(snapshot.Activity);
        _userDirectoryEntries = snapshot.Platform.Users;
        _userDirectoryAvailable = analyticsAvailable;
        RefreshUserDirectoryRows();

        _membershipDetail.Text = !analyticsAvailable
            ? "Unavailable"
            : snapshot.Platform.UnclassifiedPaidMemberships > 0
                ? $"Needs attention  ·  {snapshot.Platform.UnclassifiedPaidMemberships} unmapped"
                : "Healthy  ·  all plans mapped";
        _membershipDetail.ForeColor = !analyticsAvailable ? Muted : snapshot.Platform.UnclassifiedPaidMemberships > 0 ? Warning : Success;
        var conversion = snapshot.Platform.TotalUsers > 0 ? snapshot.Platform.PaidMemberships * 100d / snapshot.Platform.TotalUsers : 0;
        _conversionDetail.Text = analyticsAvailable ? $"{conversion:0.0}%  ·  {snapshot.Platform.PaidMemberships}/{snapshot.Platform.TotalUsers}" : "Unavailable";
        _conversionDetail.ForeColor = analyticsAvailable ? Ink : Muted;
        _analyticsChecked.Text = analyticsAvailable
            ? $"Firebase Auth + RTDB  ·  {snapshot.Platform.RetrievedAt:h:mm:ss tt}"
            : isRemote
                ? "Disabled in remote read-only mode"
                : "Firebase admin access required";

        _modeValue.Text = snapshot.Mode.Length > 0 ? char.ToUpperInvariant(snapshot.Mode[0]) + snapshot.Mode[1..] : "Unknown";
        _checkedValue.Text = DateTime.Now.ToString("h:mm:ss tt");
        _liveStatus.Text = $"{(isRemote ? "REMOTE" : analyticsAvailable ? "LIVE DATA" : "LOCAL DATA")}  •  {DateTime.Now:h:mm tt}";
        _liveStatus.ForeColor = isRemote || analyticsAvailable ? Success : Warning;
        var sleepingByDesign = !snapshot.OllamaReady && snapshot.BridgeReady && string.Equals(snapshot.Mode, "auto", StringComparison.OrdinalIgnoreCase);
        SetStatus("Protected Ollama", snapshot.OllamaReady, snapshot.OllamaReady
            ? isRemote ? "Ready · remote desktop" : "Ready · 127.0.0.1:11435"
            : sleepingByDesign ? "Sleeping by design"
            : isRemote ? "Unavailable remotely" : "Unavailable on 11435", sleepingByDesign);
        SetStatus("Protected bridge", snapshot.BridgeReady, snapshot.BridgeReady ? "Healthy" : "Offline");
        var tunnelState = AnalysisAppLogic.ResolvePublicTunnelDisplayState(snapshot.TunnelDesiredOn, snapshot.TunnelReady);
        switch (tunnelState)
        {
            case PublicTunnelDisplayState.Off:
                SetStatus("Public tunnel", false, "Off", neutral: true);
                break;
            case PublicTunnelDisplayState.Healthy:
                SetStatus("Public tunnel", true, "Healthy");
                break;
            default:
                SetStatus("Public tunnel", false, "Recovering");
                break;
        }
        UpdateTunnelToggle(tunnelState);
        var approvedModels = AnalysisAppLogic.SummarizeApprovedOllamaModels(snapshot.Models, snapshot.ModelsChecked);
        SetStatus("Approved models", approvedModels.IsComplete, approvedModels.HealthText, !approvedModels.WasChecked);
        var recoveryTaskState = AnalysisAppLogic.ResolveRecoveryTaskDisplayState(
            snapshot.RecoveryTask.Installed,
            snapshot.RecoveryTask.Enabled,
            snapshot.RecoveryTask.SchedulerState,
            snapshot.RecoveryTask.LastTaskResult,
            snapshot.RecoveryTask.LastRunTime);
        var recoveryTaskText = recoveryTaskState switch
        {
            RecoveryTaskDisplayState.Ready when snapshot.RecoveryTask.LastRunTime is DateTime lastRun => $"Ready · last {lastRun:h:mm tt}",
            RecoveryTaskDisplayState.Ready => "Ready",
            RecoveryTaskDisplayState.Running => "Running",
            RecoveryTaskDisplayState.Queued => "Queued",
            RecoveryTaskDisplayState.Waiting => "Waiting for first run",
            RecoveryTaskDisplayState.NotInstalled => "Not installed",
            RecoveryTaskDisplayState.Disabled => "Disabled",
            RecoveryTaskDisplayState.NeedsAttention => $"Needs attention · {AnalysisAppLogic.FormatRecoveryTaskResult(snapshot.RecoveryTask.LastTaskResult)}",
            _ => "Status unavailable",
        };
        var recoveryTaskHealthy = recoveryTaskState is RecoveryTaskDisplayState.Ready or RecoveryTaskDisplayState.Running or RecoveryTaskDisplayState.Queued;
        var recoveryTaskNeutral = recoveryTaskState is RecoveryTaskDisplayState.Waiting or RecoveryTaskDisplayState.Unavailable;
        SetStatus(RecoveryTaskStatusKey, recoveryTaskHealthy, recoveryTaskText, recoveryTaskNeutral);
        if (_statusValues.TryGetValue(RecoveryTaskStatusKey, out var recoveryTaskLabels))
        {
            var resultText = AnalysisAppLogic.FormatRecoveryTaskResult(snapshot.RecoveryTask.LastTaskResult);
            foreach (var label in recoveryTaskLabels)
                label.AccessibleDescription = $"{snapshot.RecoveryTask.Name}. {recoveryTaskText}. Last completed result: {resultText}.";
        }
        var remoteAgentText = AnalysisAppLogic.FormatRemoteAnalysisAgentState(snapshot.RemoteAgentState);
        var remoteAgentNeutral = AnalysisAppLogic.IsRemoteAnalysisAgentStateNeutral(snapshot.RemoteAgentState);
        SetStatus(RemoteAgentTaskStatusKey, snapshot.RemoteAgentReady, remoteAgentText, remoteAgentNeutral);
        if (_statusValues.TryGetValue(RemoteAgentTaskStatusKey, out var remoteAgentLabels))
        {
            foreach (var label in remoteAgentLabels)
                label.AccessibleDescription = $"{AnalysisAppLogic.RemoteAnalysisAgentTaskName}. {remoteAgentText}.";
        }
        foreach (var button in _modeButtons)
        {
            var active = string.Equals(button.Tag?.ToString(), snapshot.Mode, StringComparison.OrdinalIgnoreCase);
            button.ForeColor = active ? Color.White : Ink;
            button.BackColor = active ? ApplePalette.BlueFill : Card;
            button.FlatAppearance.BorderColor = active ? ApplePalette.BlueFill : Border;
        }

        _idle.SelectedIndex = AnalysisAppLogic.IdleIndexFromMinutes(snapshot.IdleMinutes);
        _modelCount.Text = approvedModels.WasChecked
            ? $"{approvedModels.ReadyCount}/{approvedModels.RequiredCount} ready"
            : $"{approvedModels.RequiredCount} approved";
        _modelActionStatus.Text = approvedModels.DetailText;
        if (_modelInstallCancellation is null)
        {
            UpdateModelButton(_fastModelButton, approvedModels.Get(ApprovedOllamaModelProfile.Fast));
            UpdateModelButton(_smartModelButton, approvedModels.Get(ApprovedOllamaModelProfile.Smart));
            UpdateModelButton(_visionModelButton, approvedModels.Get(ApprovedOllamaModelProfile.Vision));
        }

        _overviewSignal.Text = analyticsAvailable
            ? $"{snapshot.Platform.ActiveUsers} active now  ·  {snapshot.Platform.PaidMemberships} paid  ·  AI {snapshot.Mode}"
            : isRemote
                ? $"Remote read-only status  ·  AI {snapshot.Mode}"
                : $"Platform analytics unavailable  ·  AI {snapshot.Mode}";
        var lastRequest = snapshot.LastActivity is DateTime last ? last.ToString("g") : "No recent request";
        var modelHealth = approvedModels.WasChecked ? approvedModels.HealthText : "not checked";
        _healthDetail.Text = $"Mode: {_modeValue.Text}  ·  Timeout: {FormatMinutes(snapshot.IdleMinutes)}  ·  Approved models: {modelHealth}\nBridge: {(snapshot.BridgeReady ? "healthy" : "offline")}  ·  Tunnel: {TunnelStateText(tunnelState)}  ·  Last request: {lastRequest}\n{AnalysisAppLogic.RemoteAnalysisAgentTaskName}: {remoteAgentText}";
        _workspaceStatus.Text = isRemote
            ? "Remote desktop · workspace paths are not exposed"
            : _client.IsConfigured ? $"Workspace\n{_client.RepoRoot}" : "Workspace not configured · protected AI controls unavailable";
        _logDirectoryStatus.Text = isRemote
            ? "Remote mode is read-only · logs and credentials stay on the desktop"
            : $"Local metadata logs\n{_client.LogDirectory}";

        _recent.Rows.Clear();
        foreach (var item in snapshot.Activity.Take(20))
            _recent.Rows.Add(item.Time.ToString("h:mm:ss tt"), item.Feature, item.Model, item.DurationMs > 0 ? $"{item.DurationMs / 1000d:0.0}s" : "—", item.Result == "success" ? "●  Success" : "●  Error");
        ApplyConnectionModeRestrictions();
    }

    private void RefreshUserDirectoryRows()
    {
        if (_userDirectory.ColumnCount == 0) return;
        var selectedUid = SelectedUserDirectoryEntry()?.Uid;
        var query = _userSearch.Text;
        var filtered = _userDirectoryEntries
            .Where(user => AnalysisAppLogic.MatchesUserDirectoryQuery(user.UserLabel, user.Uid, query))
            .ToArray();

        _userDirectory.SuspendLayout();
        try
        {
            _userDirectory.Rows.Clear();
            foreach (var user in filtered)
            {
                var rowIndex = _userDirectory.Rows.Add(
                    user.UserLabel,
                    user.Uid,
                    user.Paid ? "Paid" : "Free",
                    user.Active ? "●  Online" : "○  Offline");
                var row = _userDirectory.Rows[rowIndex];
                row.Tag = user;
                row.Cells[2].Style.ForeColor = user.Paid ? Accent : Muted;
                row.Cells[3].Style.ForeColor = user.Active ? Success : Muted;
            }

            _userDirectory.ClearSelection();
            _userDirectory.CurrentCell = null;
            if (!string.IsNullOrWhiteSpace(selectedUid))
            {
                var matchingRow = _userDirectory.Rows
                    .Cast<DataGridViewRow>()
                    .FirstOrDefault(row => row.Tag is UserDirectoryEntry user && string.Equals(user.Uid, selectedUid, StringComparison.Ordinal));
                if (matchingRow is not null)
                {
                    matchingRow.Selected = true;
                    _userDirectory.CurrentCell = matchingRow.Cells[0];
                }
            }
        }
        finally { _userDirectory.ResumeLayout(); }

        _userDirectoryCount.Text = !_userDirectoryAvailable
            ? _connectionMode == AnalysisConnectionMode.Remote
                ? "Directory disabled in remote read-only mode"
                : "Directory unavailable · Firebase admin access required"
            : _userDirectoryEntries.Length == 0
                ? "No Firebase Auth accounts found"
                : filtered.Length == 0
                    ? $"No matches · {_userDirectoryEntries.Length:N0} total account{(_userDirectoryEntries.Length == 1 ? "" : "s")}"
                    : string.IsNullOrWhiteSpace(query)
                        ? $"{filtered.Length:N0} account{(filtered.Length == 1 ? "" : "s")} · refreshes automatically every five minutes"
                        : $"{filtered.Length:N0} of {_userDirectoryEntries.Length:N0} accounts";
        UpdateUserDirectorySelection();
    }

    private Task CopySelectedUserUidAsync()
    {
        if (!RequireCapability(AnalysisCapability.ViewUsers, "User directory access")) return Task.CompletedTask;
        if (SelectedUserDirectoryEntry() is not { } user) return Task.CompletedTask;
        try
        {
            Clipboard.SetText(user.Uid);
            _userDirectoryCount.Text = $"UID copied for {user.UserLabel}";
        }
        catch (Exception error)
        {
            _userDirectoryCount.Text = $"UID copy failed · {error.Message}";
        }
        return Task.CompletedTask;
    }

    private void UpdateUserDirectorySelection()
    {
        if (_copyUserUidButton is not null)
            _copyUserUidButton.Enabled = _connectionMode == AnalysisConnectionMode.Local && !_busy && SelectedUserDirectoryEntry() is not null;
    }

    private UserDirectoryEntry? SelectedUserDirectoryEntry()
        => _userDirectory.SelectedRows.Count > 0 && _userDirectory.SelectedRows[0].Tag is UserDirectoryEntry user
            ? user
            : null;

    private async Task SaveIdleTimeoutAsync()
    {
        if (!RequireCapability(AnalysisCapability.ChangeAiMode, "AI timeout changes")) return;
        if (_busy || _lastSnapshot is null) return;
        var minutes = IdleMinutes();
        var previous = _lastSnapshot.IdleMinutes;
        _modelActionStatus.Text = "Saving timeout…";
        SetBusy(true);
        try
        {
            await _client.SetModeAsync(_lastSnapshot.Mode, minutes);
            _lastSnapshot = _lastSnapshot with { IdleMinutes = minutes };
            _modelActionStatus.Text = $"Saved · Auto sleeps after {FormatMinutes(minutes)}";
            AppendConsole($"Auto idle timeout saved at {minutes} minutes.");
        }
        catch (Exception error)
        {
            _idle.SelectedIndex = AnalysisAppLogic.IdleIndexFromMinutes(previous);
            _modelActionStatus.Text = "Timeout was not saved";
            AppendConsole($"Timeout change failed: {error.Message}");
            MessageBox.Show(error.Message, "Auto idle timeout", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
        await RefreshAsync(includePlatform: false);
    }

    private async Task InstallApprovedModelAsync(ApprovedOllamaModelProfile profile)
    {
        if (!RequireCapability(AnalysisCapability.InstallModels, "Model installation")) return;
        if (_modelInstallCancellation is not null)
        {
            _modelInstallCancellation.Cancel();
            _modelActionStatus.Text = "Cancelling model operation…";
            return;
        }
        if (_busy) return;

        var approved = AnalysisAppLogic.GetApprovedOllamaModel(profile);
        var purpose = profile switch
        {
            ApprovedOllamaModelProfile.Fast => "Fast is the low-latency everyday text model.",
            ApprovedOllamaModelProfile.Smart => "Smart is the larger quality-focused text model and needs more disk space.",
            _ => "Vision powers photo scanning and calendar import.",
        };
        var answer = MessageBox.Show(
            $"Install or verify the approved {approved.DisplayName} model {approved.Model}?\n\n{purpose}\n\nThe isolated protected Ollama model store may download several gigabytes. Existing approved model data is verified and reused.",
            $"Manage {approved.DisplayName} model",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information,
            MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;

        _modelInstallCancellation = new CancellationTokenSource();
        var cancellation = _modelInstallCancellation;
        _activeModelButton = ModelButton(profile);
        SetBusy(true);
        if (_activeModelButton is not null)
        {
            _activeModelButton.Enabled = true;
            _activeModelButton.Caption = "Cancel";
        }
        _modelActionStatus.Text = $"Preparing {approved.Model}…";
        AppendConsole($"Installing or verifying approved {approved.DisplayName} model {approved.Model}…");
        var progress = new Progress<string>(message =>
        {
            var clean = message.Trim();
            if (clean.Length == 0) return;
            _modelActionStatus.Text = clean.Length > 120 ? clean[..120] + "…" : clean;
        });
        try
        {
            await _client.InstallOrRepairApprovedModelAsync(approved.Model, progress, cancellation.Token);
            _modelActionStatus.Text = $"{approved.DisplayName} model ready · {approved.Model}";
            AppendConsole($"{approved.DisplayName} model {approved.Model} is ready.");
        }
        catch (OperationCanceledException)
        {
            _modelActionStatus.Text = "Model operation cancelled";
            AppendConsole($"{approved.DisplayName} model operation cancelled.");
        }
        catch (Exception error)
        {
            _modelActionStatus.Text = "Model repair failed · see Console";
            AppendConsole($"{approved.DisplayName} model repair failed: {error.Message}");
            MessageBox.Show(error.Message, $"{approved.DisplayName} model", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            if (_activeModelButton is not null) _activeModelButton.Caption = $"Repair {approved.DisplayName}";
            _activeModelButton = null;
            cancellation.Dispose();
            _modelInstallCancellation = null;
            SetBusy(false);
        }
        await RefreshAsync(includePlatform: false);
    }

    private AppleActionButton? ModelButton(ApprovedOllamaModelProfile profile)
        => profile switch
        {
            ApprovedOllamaModelProfile.Fast => _fastModelButton,
            ApprovedOllamaModelProfile.Smart => _smartModelButton,
            ApprovedOllamaModelProfile.Vision => _visionModelButton,
            _ => null,
        };

    private static void UpdateModelButton(AppleActionButton? button, ApprovedOllamaModelStatus status)
    {
        if (button is null) return;
        var action = status.State switch
        {
            ApprovedOllamaModelState.Ready => "Verify",
            ApprovedOllamaModelState.Missing => "Install",
            _ => "Repair",
        };
        button.Caption = $"{action} {status.Definition.DisplayName}";
        button.AccessibleDescription = $"Install or verify the approved {status.Definition.DisplayName} model {status.Definition.Model}. Current status: {status.State}.";
    }

    private async Task ChooseWorkspaceAsync()
    {
        if (!RequireCapability(AnalysisCapability.ChooseWorkspace, "Workspace selection")) return;
        using var dialog = new FolderBrowserDialog
        {
            Description = "Choose the Minimalist Chat repository folder",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false,
            InitialDirectory = _client.IsConfigured ? _client.RepoRoot : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            _client.ConfigureRepoRoot(dialog.SelectedPath);
            _workspaceStatus.Text = $"Workspace\n{_client.RepoRoot}";
            _logDirectoryStatus.Text = $"Local metadata logs\n{_client.LogDirectory}";
            AppendConsole($"Workspace configured: {_client.RepoRoot}");
            await RefreshAsync(includePlatform: true);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Choose workspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
            AppendConsole($"Workspace configuration failed: {error.Message}");
        }
    }

    private Task OpenLogsAsync()
    {
        if (!RequireCapability(AnalysisCapability.ReadLocalLogs, "Local log access")) return Task.CompletedTask;
        _client.OpenLogs();
        AppendConsole("Opened the local log folder.");
        return Task.CompletedTask;
    }

    private async Task HandleShortcutAsync(KeyEventArgs args)
    {
        if (_initializing)
        {
            args.SuppressKeyPress = true;
            return;
        }
        if (!args.Control)
        {
            if (args.KeyCode == Keys.Escape && string.Equals(_activePageKey, "Users", StringComparison.OrdinalIgnoreCase) && _userSearch.TextLength > 0)
            {
                _userSearch.Clear();
                _userSearch.Focus();
                args.SuppressKeyPress = true;
            }
            return;
        }
        if (args.KeyCode == Keys.F && string.Equals(_activePageKey, "Users", StringComparison.OrdinalIgnoreCase))
        {
            _userSearch.Focus();
            _userSearch.SelectAll();
            args.SuppressKeyPress = true;
            return;
        }
        var page = args.KeyCode switch
        {
            Keys.D1 => "Overview",
            Keys.D2 => "Users",
            Keys.D3 => "AI",
            Keys.D4 => "Health",
            Keys.D5 => "Console",
            _ => null,
        };
        if (page is not null)
        {
            ShowPage(page);
            args.SuppressKeyPress = true;
            return;
        }
        if (args.KeyCode == Keys.R)
        {
            args.SuppressKeyPress = true;
            await RefreshAsync(includePlatform: true);
        }
        else if (args.KeyCode == Keys.L)
        {
            args.SuppressKeyPress = true;
            ShowPage("Console");
            _consoleInput.Focus();
        }
    }

    private static string FormatMinutes(int minutes) => minutes switch
    {
        30 => "30 minutes",
        60 => "1 hour",
        120 => "2 hours",
        240 => "4 hours",
        _ => $"{minutes} minutes",
    };

    private async Task SetModeAsync(string mode)
    {
        if (!RequireCapability(AnalysisCapability.ChangeAiMode, "AI mode changes")) return;
        if (_busy) return;
        SetBusy(true);
        try { await _client.SetModeAsync(mode, IdleMinutes()); AppendConsole($"AI mode changed to {mode} ({IdleMinutes()} minute timeout)."); }
        catch (Exception error) { AppendConsole($"Mode change failed: {error.Message}"); MessageBox.Show(error.Message, "AI mode", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { SetBusy(false); }
        await RefreshAsync();
    }

    private Task ToggleTunnelAsync()
        => RunActionAsync(_lastSnapshot?.TunnelDesiredOn == true ? "stop-tunnel" : "start-tunnel");

    private async Task RunActionAsync(string action)
    {
        var capability = action is "start-tunnel" or "stop-tunnel"
            ? AnalysisCapability.ControlTunnel
            : AnalysisCapability.ControlBridge;
        if (!RequireCapability(capability, capability == AnalysisCapability.ControlTunnel ? "Tunnel control" : "Bridge control")) return;
        if (_busy) return;
        if (action == "stop-bridge" && MessageBox.Show("Stopping the bridge makes website AI unavailable until it is started again.", "Stop protected bridge?", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        if (action == "start-tunnel" && MessageBox.Show(
            "Turning the public tunnel on enables its fixed Cloudflare route and automatic recovery. The protected bridge must be healthy. Continue?",
            "Turn public tunnel on?",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        if (action == "stop-tunnel" && MessageBox.Show(
            "Turning the public tunnel off disables automatic recovery and makes public website AI unavailable until you turn it on again. Continue?",
            "Turn public tunnel off?",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        SetBusy(true);
        try
        {
            AppendConsole($"Running {action}…");
            await _client.RunBridgeActionAsync(action);
            await Task.Delay(action is "stop-bridge" or "stop-tunnel" ? 700 : 2500);
            AppendConsole($"{action} completed.");
        }
        catch (Exception error) { AppendConsole($"{action} failed: {error.Message}"); MessageBox.Show(error.Message, "Infrastructure control", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { SetBusy(false); }
        await RefreshAsync();
    }

    private async Task RunConsoleCommandAsync()
    {
        var command = _consoleInput.Text.Trim();
        _consoleInput.Clear();
        if (command.Length == 0) return;
        if (_consoleHistory.Count == 0 || !string.Equals(_consoleHistory[^1], command, StringComparison.Ordinal))
            _consoleHistory.Add(command);
        if (_consoleHistory.Count > 100) _consoleHistory.RemoveAt(0);
        _consoleHistoryIndex = _consoleHistory.Count;
        await ExecuteConsoleCommandAsync(command);
    }

    private async Task ExecuteConsoleCommandAsync(string command)
    {
        if (!RequireCapability(AnalysisCapability.UseConsole, "Administrator console access")) return;
        AppendConsole($"> {command}");
        var parts = AnalysisAppLogic.TokenizeCommand(command).ToArray();
        if (parts.Length == 0) return;
        var verb = parts[0].ToLowerInvariant();
        var normalized = string.Join(' ', parts).ToLowerInvariant();
        switch (normalized)
        {
            case "help":
                AppendConsole("System: status | refresh | start | restart | stop | on | off | auto | logs | open logs | clear | copy");
                AppendConsole("Moderation: summaries, user and room inspection, ban/mute/kick, exact message removal, and account deletion. Type 'moderation-help'.");
                break;
            case "moderation-help":
                foreach (var line in AnalysisAppLogic.GetModerationHelpLines()) AppendConsole(line);
                break;
            case "status":
            case "refresh": await RefreshAsync(); AppendSnapshotToConsole(); break;
            case "start": await RunActionAsync("start-bridge"); break;
            case "restart": await RunActionAsync("restart-bridge"); break;
            case "stop": await RunActionAsync("stop-bridge"); break;
            case "on": await SetModeAsync("on"); break;
            case "off": await SetModeAsync("off"); break;
            case "auto": await SetModeAsync("auto"); break;
            case "logs": AppendConsole(_client.ReadSanitizedLogs(), false); break;
            case "open logs": _client.OpenLogs(); AppendConsole("Opened the local log folder."); break;
            case "clear": _console.Clear(); break;
            case "copy":
                try
                {
                    if (_console.TextLength > 0) Clipboard.SetText(_console.Text);
                    AppendConsole("Console output copied.");
                }
                catch (Exception error) { AppendConsole($"Copy failed: {error.Message}", false); }
                break;
            default:
                if (AnalysisAppLogic.ClassifyCommand(parts) == ConsoleCommandCategory.Moderation) await RunModerationCommandAsync(verb, parts);
                else AppendConsole("Unknown command. Type 'help'.");
                break;
        }
    }

    private async Task HandleConsoleInputKeyDownAsync(KeyEventArgs args)
    {
        if (args.KeyCode == Keys.Enter)
        {
            args.SuppressKeyPress = true;
            await RunConsoleCommandAsync();
            return;
        }
        if (args.KeyCode == Keys.Up && _consoleHistory.Count > 0)
        {
            args.SuppressKeyPress = true;
            _consoleHistoryIndex = Math.Max(0, _consoleHistoryIndex - 1);
            _consoleInput.Text = _consoleHistory[_consoleHistoryIndex];
            _consoleInput.SelectionStart = _consoleInput.TextLength;
        }
        else if (args.KeyCode == Keys.Down && _consoleHistory.Count > 0)
        {
            args.SuppressKeyPress = true;
            _consoleHistoryIndex = Math.Min(_consoleHistory.Count, _consoleHistoryIndex + 1);
            _consoleInput.Text = _consoleHistoryIndex < _consoleHistory.Count ? _consoleHistory[_consoleHistoryIndex] : string.Empty;
            _consoleInput.SelectionStart = _consoleInput.TextLength;
        }
    }

    private Task CopyConsoleAsync()
    {
        try
        {
            if (_console.TextLength > 0) Clipboard.SetText(_console.Text);
            AppendConsole("Console output copied.");
        }
        catch (Exception error) { AppendConsole($"Copy failed: {error.Message}", false); }
        return Task.CompletedTask;
    }

    private void ShowConsoleCategory(string category)
    {
        switch (category)
        {
            case "system":
                AppendConsole("System commands: status · refresh · start · restart · stop · on · off · auto · logs · open logs");
                break;
            case "moderation":
                AppendConsole("Moderation commands include summaries, lists, room inspection, user controls, and exact message removal. Type 'moderation-help'.");
                break;
            default:
                AppendConsole("Type 'help' for system commands or 'moderation-help' for guarded user operations.");
                break;
        }
        _consoleInput.Focus();
    }

    private async Task RunModerationCommandAsync(string verb, string[] parts)
    {
        if (!RequireCapability(AnalysisCapability.ModerateUsers, "Moderation")) return;
        if (_busy) return;
        try
        {
            var result = AnalysisAppLogic.ParseModerationCommand(parts);
            if (!result.Success || result.Command is null)
                throw new ArgumentException(result.Error ?? "Invalid moderation command.");
            var command = result.Command;
            if (!string.Equals(verb, command.CanonicalVerb, StringComparison.OrdinalIgnoreCase))
                AppendConsole($"Alias '{verb}' → {command.CanonicalVerb}");

            SetBusy(true);
            if (command.ConfirmationPolicy == ModerationConfirmationPolicy.None)
            {
                var output = command.Kind switch
                {
                    ModerationCommandKind.UserStatus => await _client.GetModerationStatusAsync(command.Arguments[0]),
                    ModerationCommandKind.ModerationSummary => await _client.GetModerationSummaryAsync(),
                    ModerationCommandKind.ListBanned => await _client.ListModeratedUsersAsync("isBanned"),
                    ModerationCommandKind.ListMuted => await _client.ListModeratedUsersAsync("isMuted"),
                    ModerationCommandKind.UserRooms => await _client.GetUserRoomsAsync(command.Arguments[0]),
                    ModerationCommandKind.RoomStatus => await _client.GetRoomStatusAsync(command.Arguments[0]),
                    ModerationCommandKind.RoomMembers => await _client.GetRoomMembersAsync(command.Arguments[0]),
                    ModerationCommandKind.RoomLog => await _client.GetRoomLogAsync(command.Arguments[0], int.Parse(command.Arguments[1], CultureInfo.InvariantCulture)),
                    _ => throw new InvalidOperationException("That moderation read command is not implemented."),
                };
                AppendConsole(output);
                return;
            }

            string description;
            if (command.Kind == ModerationCommandKind.DeleteAccount)
            {
                description = $"PERMANENTLY delete Firebase Auth account {command.Arguments[0]} and its primary application records? This cannot be undone.";
            }
            else if (command.Kind == ModerationCommandKind.DeleteMessage)
            {
                var preview = await _client.GetMessageDeletionPreviewAsync(
                    command.Arguments[0],
                    EmptyToNull(command.Arguments[1]),
                    EmptyToNull(command.Arguments[2]),
                    command.Arguments[3]);
                description = $"PERMANENTLY delete {preview}? This removes the message for everyone and cannot be undone.";
            }
            else
            {
                description = $"Run '{command.CanonicalVerb}' for the exact IDs shown in this command?";
            }
            if (MessageBox.Show(description, "Confirm administrator action", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            {
                AppendConsole("Moderation action cancelled.");
                return;
            }

            switch (command.Kind)
            {
                case ModerationCommandKind.Ban: await _client.SetUserModerationFlagAsync(command.Arguments[0], "isBanned", true); break;
                case ModerationCommandKind.Unban: await _client.SetUserModerationFlagAsync(command.Arguments[0], "isBanned", false); break;
                case ModerationCommandKind.Mute: await _client.SetUserModerationFlagAsync(command.Arguments[0], "isMuted", true); break;
                case ModerationCommandKind.Unmute: await _client.SetUserModerationFlagAsync(command.Arguments[0], "isMuted", false); break;
                case ModerationCommandKind.RoomMute: await _client.SetRoomMuteAsync(command.Arguments[0], command.Arguments[1], command.Arguments[2]); break;
                case ModerationCommandKind.RoomUnmute: await _client.RemoveRoomMuteAsync(command.Arguments[0], command.Arguments[1]); break;
                case ModerationCommandKind.Kick: await _client.KickFromRoomAsync(command.Arguments[0], command.Arguments[1]); break;
                case ModerationCommandKind.DeleteMessage:
                    await _client.DeleteMessageAsync(
                        command.Arguments[0],
                        EmptyToNull(command.Arguments[1]),
                        EmptyToNull(command.Arguments[2]),
                        command.Arguments[3]);
                    break;
                case ModerationCommandKind.DeleteAccount: await _client.DeleteUserAccountAsync(command.Arguments[0]); break;
                default: throw new InvalidOperationException("That moderation mutation is not implemented.");
            }
            AppendConsole($"{command.CanonicalVerb} completed successfully.");
        }
        catch (Exception error)
        {
            AppendConsole($"{verb} failed: {error.Message}");
            MessageBox.Show(error.Message, "Moderation command", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private static string? EmptyToNull(string value)
        => string.IsNullOrEmpty(value) ? null : value;

    private void AppendSnapshotToConsole()
    {
        if (_lastSnapshot is null) { AppendConsole("No snapshot is available."); return; }
        var snapshot = _lastSnapshot;
        var approvedModels = AnalysisAppLogic.SummarizeApprovedOllamaModels(snapshot.Models, snapshot.ModelsChecked);
        var modelHealth = approvedModels.WasChecked ? approvedModels.HealthText : "not checked";
        var tunnelState = AnalysisAppLogic.ResolvePublicTunnelDisplayState(snapshot.TunnelDesiredOn, snapshot.TunnelReady);
        AppendConsole($"Users {snapshot.Platform.TotalUsers} | Active {snapshot.Platform.ActiveUsers} | Paid {snapshot.Platform.PaidMemberships} | Mode {snapshot.Mode} | Idle {snapshot.IdleMinutes}m | Approved models {modelHealth} | Bridge {(snapshot.BridgeReady ? "healthy" : "offline")} | Tunnel {TunnelStateText(tunnelState)}");
    }

    private void UpdateTunnelToggle(PublicTunnelDisplayState state)
    {
        if (_tunnelToggleButton is null) return;

        var desiredOn = state != PublicTunnelDisplayState.Off;
        _tunnelToggleButton.Caption = desiredOn ? "Turn tunnel off" : "Turn tunnel on";
        switch (state)
        {
            case PublicTunnelDisplayState.Healthy:
                _tunnelToggleButton.BackColor = Color.FromArgb(237, 248, 240);
                _tunnelToggleButton.ForeColor = Success;
                _tunnelToggleButton.BorderColor = Color.FromArgb(145, Success);
                _tunnelToggleButton.AccessibleDescription = "Public tunnel is healthy and automatic recovery is on. Press to turn it off after confirmation.";
                break;
            case PublicTunnelDisplayState.Recovering:
                _tunnelToggleButton.BackColor = Color.FromArgb(255, 247, 232);
                _tunnelToggleButton.ForeColor = Warning;
                _tunnelToggleButton.BorderColor = Color.FromArgb(155, Warning);
                _tunnelToggleButton.AccessibleDescription = "Public tunnel is recovering and automatic recovery is on. Press to turn it off after confirmation.";
                break;
            default:
                _tunnelToggleButton.BackColor = Color.FromArgb(238, 245, 255);
                _tunnelToggleButton.ForeColor = ApplePalette.BlueFill;
                _tunnelToggleButton.BorderColor = Color.FromArgb(145, ApplePalette.BlueFill);
                _tunnelToggleButton.AccessibleDescription = "Public tunnel is off. Press to turn it on after confirmation.";
                break;
        }
    }

    private static string TunnelStateText(PublicTunnelDisplayState state)
        => state switch
        {
            PublicTunnelDisplayState.Off => "off",
            PublicTunnelDisplayState.Healthy => "healthy",
            _ => "recovering",
        };

    private void AppendConsole(string message, bool timestamp = true)
    {
        if (_console.IsDisposed) return;
        _console.SelectionStart = _console.TextLength;
        if (timestamp)
        {
            _console.SelectionColor = SystemInformation.HighContrast ? SystemColors.GrayText : Color.FromArgb(145, 145, 154);
            _console.AppendText($"[{DateTime.Now:HH:mm:ss}]  ");
        }
        _console.SelectionColor = SystemInformation.HighContrast
            ? SystemColors.WindowText
            : message.StartsWith('>')
                ? Color.FromArgb(80, 170, 255)
                : message.Contains("failed", StringComparison.OrdinalIgnoreCase) || message.Contains("error", StringComparison.OrdinalIgnoreCase)
                    ? Color.FromArgb(255, 120, 125)
                    : message.Contains("completed", StringComparison.OrdinalIgnoreCase) || message.Contains("ready", StringComparison.OrdinalIgnoreCase) || message.Contains("success", StringComparison.OrdinalIgnoreCase)
                        ? Color.FromArgb(78, 214, 117)
                        : Color.FromArgb(235, 235, 241);
        _console.AppendText(message + Environment.NewLine);
        _console.SelectionColor = _console.ForeColor;
        _console.SelectionStart = _console.TextLength;
        _console.ScrollToCaret();
    }

    private int IdleMinutes() => AnalysisAppLogic.IdleMinutesFromIndex(_idle.SelectedIndex);

    private void SetMetric(string key, string text)
    {
        if (_metricValues.TryGetValue(key, out var labels)) foreach (var label in labels) label.Text = text;
    }

    private void SetStatus(string key, bool ok, string text, bool neutral = false)
    {
        if (!_statusValues.TryGetValue(key, out var labels)) return;
        foreach (var label in labels)
        {
            label.Text = $"●  {text}";
            label.ForeColor = neutral ? Muted : ok ? Success : Warning;
        }
    }

    private void SetBusy(bool busy)
    {
        _busy = busy; UseWaitCursor = busy;
        _refreshButton.Enabled = !busy && !_refreshing;
        _consoleInput.Enabled = !busy;
        _idle.Enabled = !busy;
        foreach (var button in _modeButtons) button.Enabled = !busy;
        foreach (var button in _actionButtons) button.Enabled = !busy;
        UpdateUserDirectorySelection();
        ApplyConnectionModeRestrictions();
    }

    private void ApplyConnectionModeRestrictions()
    {
        var local = _connectionMode == AnalysisConnectionMode.Local;
        var remoteSessionVisibilityChanged = _remoteSessionButton.Visible == local;
        _connectionSelector.Enabled = !_busy && !_refreshing;
        _remoteSessionButton.Visible = !local;
        _remoteSessionButton.Caption = _remoteClient.HasStoredSession ? "Sign out" : "Sign in";
        _remoteSessionButton.Enabled = !local && !_busy && !_refreshing;
        _remoteSessionButton.AccessibleDescription = _remoteClient.HasStoredSession
            ? "Remove the DPAPI-protected Cloudflare Access session from this Windows user account."
            : "Sign in to the read-only remote Analysis agent with Cloudflare Access in the system browser.";

        if (_navButtons.TryGetValue("Users", out var usersNav)) usersNav.Enabled = local && !_busy;
        if (_navButtons.TryGetValue("Console", out var consoleNav)) consoleNav.Enabled = local && !_busy;
        foreach (var button in _modeButtons) button.Enabled = local && !_busy;
        _idle.Enabled = local && !_busy;
        if (_fastModelButton is not null) _fastModelButton.Enabled = local && !_busy;
        if (_smartModelButton is not null) _smartModelButton.Enabled = local && !_busy;
        if (_visionModelButton is not null) _visionModelButton.Enabled = local && !_busy;
        if (_bridgeActions is not null)
            foreach (Control control in _bridgeActions.Controls) control.Enabled = local && !_busy;
        _userSearch.Enabled = local && !_busy;
        _userDirectory.Enabled = local && !_busy;
        if (_copyUserUidButton is not null)
            _copyUserUidButton.Enabled = local && !_busy && SelectedUserDirectoryEntry() is not null;
        _consoleInput.Enabled = local && !_busy;
        if (!local && (_activePageKey is "Users" or "Console")) ShowPage("Overview");
        if (remoteSessionVisibilityChanged) ApplyResponsiveLayout(force: true);
    }

    private bool RequireCapability(AnalysisCapability capability, string operation)
    {
        if (AnalysisAppLogic.IsCapabilityAllowed(_connectionMode, capability)) return true;
        var message = $"{operation} is disabled in Remote mode. Switch to This PC for administrator controls.";
        AppendConsole(message);
        return false;
    }

    private static void Register(Dictionary<string, List<Label>> map, string key, Label label)
    {
        if (!map.TryGetValue(key, out var labels)) map[key] = labels = [];
        labels.Add(label);
    }

}
