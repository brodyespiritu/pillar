// Pillar — macOS desktop widget (WidgetKit).
//
// Shows this week's aggregate numbers, pulled from the public widget-stats
// edge function (counts only — the endpoint returns no personal data, so the
// widget needs no login). Built as an .appex in CI and embedded into the
// Tauri app bundle; see .github/workflows/build-installers.yml.

import WidgetKit
import SwiftUI

// ── Data ────────────────────────────────────────────────────────────

struct Stats: Codable {
    var guestsThisWeek: Int
    var prospectsThisWeek: Int
    var careActive: Int
    var weekLabel: String
    var nextService: String?
}

struct StatsEntry: TimelineEntry {
    let date: Date
    let stats: Stats?
    let nextService: Date?
}

private let statsURL = URL(string: "https://dxiqhequrfdodeyqzowz.supabase.co/functions/v1/widget-stats")!

private func placeholderStats() -> Stats {
    Stats(guestsThisWeek: 12, prospectsThisWeek: 3, careActive: 5,
          weekLabel: "This week", nextService: nil)
}

private func parseISO(_ s: String?) -> Date? {
    guard let s else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

// ── Timeline ────────────────────────────────────────────────────────

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> StatsEntry {
        StatsEntry(date: .now, stats: placeholderStats(), nextService: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatsEntry) -> Void) {
        fetch { completion($0) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatsEntry>) -> Void) {
        fetch { entry in
            // Refresh every 30 minutes; Sunday mornings change fast enough.
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: .now)!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetch(_ done: @escaping (StatsEntry) -> Void) {
        var req = URLRequest(url: statsURL)
        req.timeoutInterval = 15
        URLSession.shared.dataTask(with: req) { data, _, _ in
            var stats: Stats? = nil
            if let data { stats = try? JSONDecoder().decode(Stats.self, from: data) }
            done(StatsEntry(date: .now, stats: stats, nextService: parseISO(stats?.nextService)))
        }.resume()
    }
}

// ── Views ───────────────────────────────────────────────────────────

private let navy = Color(red: 0x0B / 255, green: 0x35 / 255, blue: 0x58 / 255)
private let accent = Color(red: 0x00 / 255, green: 0x6B / 255, blue: 0xFF / 255)

struct MetricBlock: View {
    let value: Int
    let label: String
    var color: Color = navy

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(color)
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

struct PillarWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StatsEntry

    var body: some View {
        Group {
            if let s = entry.stats {
                if family == .systemMedium { medium(s) } else { small(s) }
            } else {
                VStack(spacing: 6) {
                    Text("Pillar").font(.headline).foregroundStyle(navy)
                    Text("Couldn't reach the church data — check back shortly.")
                        .font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
    }

    private func header(_ s: Stats) -> some View {
        HStack {
            Text("Pillar").font(.system(size: 12, weight: .heavy)).foregroundStyle(navy)
            Spacer()
            Text(s.weekLabel).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
        }
    }

    private func small(_ s: Stats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header(s)
            Spacer(minLength: 0)
            MetricBlock(value: s.guestsThisWeek, label: "Guests this week", color: accent)
            HStack(spacing: 14) {
                MetricBlock(value: s.prospectsThisWeek, label: "Prospects")
                MetricBlock(value: s.careActive, label: "In care")
            }
        }
    }

    private func medium(_ s: Stats) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            header(s)
            HStack(alignment: .top, spacing: 22) {
                MetricBlock(value: s.guestsThisWeek, label: "Guests this week", color: accent)
                MetricBlock(value: s.prospectsThisWeek, label: "Prospects")
                MetricBlock(value: s.careActive, label: "In care")
                Spacer()
                if let svc = entry.nextService, svc > entry.date {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("NEXT SERVICE")
                            .font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                        Text(svc, style: .relative)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(navy)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
        }
    }
}

// ── Widget ──────────────────────────────────────────────────────────

struct PillarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PillarStats", provider: Provider()) { entry in
            PillarWidgetView(entry: entry)
        }
        .configurationDisplayName("Pillar — This Week")
        .description("Guests, prospects, and care at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct PillarWidgetBundle: WidgetBundle {
    var body: some Widget {
        PillarWidget()
    }
}
