//  PearBrowser — TemplatePickerScreen.swift
//
//  SwiftUI mirror of app/screens/TemplatePickerScreen.tsx.
//  Pure UI — no RPC. User picks one of 5 starter templates to
//  prefill the SiteEditorScreen with sensible default blocks.

import SwiftUI

struct SiteTemplate: Identifiable {
    let id: String
    let name: String
    let description: String
    let preview: String
    /// JSON-encodable block list passed to the editor.
    let blocks: [[String: Any]]
    let theme: [String: String]
}

struct TemplatePickerScreen: View {
    let onSelect: (SiteTemplate) -> Void
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Pick a template", onBack: onBack)

            ScrollView {
                VStack(spacing: 12) {
                    Text("Start with a template or pick Blank to build from scratch.")
                        .font(.system(size: 13))
                        .foregroundStyle(PearColors.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 4)
                    ForEach(Self.templates) { tmpl in
                        TemplateCard(template: tmpl, onTap: { onSelect(tmpl) })
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
    }

    static let templates: [SiteTemplate] = [
        SiteTemplate(
            id: "blank",
            name: "Blank",
            description: "Start from scratch",
            preview: "{ }",
            blocks: [
                ["type": "heading", "text": "My Website", "level": 1],
                ["type": "text", "text": ""]
            ],
            theme: defaultTheme
        ),
        SiteTemplate(
            id: "personal",
            name: "Personal",
            description: "About me page with bio and links",
            preview: "@",
            blocks: [
                ["type": "heading", "text": "Your Name", "level": 1],
                ["type": "text", "text": "A short bio about yourself. What you do, what you care about."],
                ["type": "divider"],
                ["type": "heading", "text": "Links", "level": 2],
                ["type": "link", "text": "GitHub", "href": "https://github.com/you"],
                ["type": "link", "text": "Twitter", "href": "https://twitter.com/you"],
                ["type": "link", "text": "Email", "href": "mailto:you@example.com"],
            ],
            theme: themeOverride(primary: "#4dabf7")
        ),
        SiteTemplate(
            id: "blog",
            name: "Blog",
            description: "Blog post with title, date, and content",
            preview: "B",
            blocks: [
                ["type": "heading", "text": "Blog Post Title", "level": 1],
                ["type": "text", "text": "Published on April 2026"],
                ["type": "divider"],
                ["type": "text", "text": "Your blog post content goes here. Write about anything."],
                ["type": "quote", "text": "A meaningful quote that supports your argument."],
                ["type": "text", "text": "Wrap up your post with a conclusion."],
            ],
            theme: themeOverride(fontFamily: "Georgia, serif")
        ),
        SiteTemplate(
            id: "portfolio",
            name: "Portfolio",
            description: "Showcase your work with sections",
            preview: "P",
            blocks: [
                ["type": "heading", "text": "Your Name — Portfolio", "level": 1],
                ["type": "text", "text": "Designer / Developer / Creator"],
                ["type": "divider"],
                ["type": "heading", "text": "Project 1", "level": 2],
                ["type": "text", "text": "Description of your first project."],
                ["type": "link", "text": "View Project", "href": "https://example.com"],
                ["type": "divider"],
                ["type": "heading", "text": "Contact", "level": 2],
                ["type": "link", "text": "Email me", "href": "mailto:you@example.com"],
            ],
            theme: themeOverride(primary: "#4ade80")
        ),
        SiteTemplate(
            id: "landing",
            name: "Landing",
            description: "Simple product / idea landing page",
            preview: "L",
            blocks: [
                ["type": "heading", "text": "Your Product", "level": 1],
                ["type": "text", "text": "A one-line pitch that sells the idea."],
                ["type": "divider"],
                ["type": "heading", "text": "Why it matters", "level": 2],
                ["type": "text", "text": "Three sentences of context."],
                ["type": "link", "text": "Get Started", "href": "https://example.com"],
            ],
            theme: themeOverride(primary: "#facc15")
        ),
    ]

    private static let defaultTheme: [String: String] = [
        "primaryColor": "#ff9500",
        "backgroundColor": "#0a0a0a",
        "textColor": "#e0e0e0",
        "fontFamily": "-apple-system, sans-serif",
    ]

    private static func themeOverride(primary: String = "#ff9500",
                                      fontFamily: String = "-apple-system, sans-serif") -> [String: String] {
        [
            "primaryColor": primary,
            "backgroundColor": "#0a0a0a",
            "textColor": "#e0e0e0",
            "fontFamily": fontFamily,
        ]
    }
}

private struct TemplateCard: View {
    let template: SiteTemplate
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(PearColors.surfaceElevated)
                        .frame(width: 56, height: 56)
                    Text(template.preview)
                        .font(.system(size: 24, weight: .bold, design: .monospaced))
                        .foregroundStyle(PearColors.accent)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(template.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PearColors.textPrimary)
                    Text(template.description)
                        .font(.system(size: 12))
                        .foregroundStyle(PearColors.textSecondary)
                }
                Spacer()
                Text(">")
                    .font(.system(size: 18))
                    .foregroundStyle(PearColors.textMuted)
            }
            .padding(14)
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
