package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.ui.theme.PearColors

/**
 * TemplatePickerScreen — mirror of ios-native `TemplatePickerScreen.swift`.
 *
 * Pure UI — no RPC. The user picks one of 5 starter templates; the caller
 * creates the site (CMD_CREATE_SITE) and lands in SiteEditorScreen with the
 * template's blocks + theme prefilled.
 *
 * Template block/theme shapes mirror backend/site-manager.js `_renderBlocks`
 * and `_renderThemeCss` exactly.
 */
data class SiteTemplate(
    val id: String,
    val name: String,
    val description: String,
    val preview: String,
    val blocks: List<EditorBlock>,
    val theme: SiteTheme,
)

object SiteTemplates {
    private val defaultTheme = SiteTheme.default

    private fun themed(primary: String, fontFamily: String = "-apple-system, sans-serif") =
        SiteTheme(
            id = "template-$primary",
            label = "Template",
            primaryColor = primary,
            fontFamily = fontFamily,
        )

    val all: List<SiteTemplate> = listOf(
        SiteTemplate(
            id = "blank",
            name = "Blank",
            description = "Start from scratch",
            preview = "{ }",
            blocks = listOf(
                EditorBlock(type = BlockType.Heading, text = "My Website", level = 1),
                EditorBlock(type = BlockType.Text),
            ),
            theme = defaultTheme,
        ),
        SiteTemplate(
            id = "personal",
            name = "Personal",
            description = "About me page with bio and links",
            preview = "@",
            blocks = listOf(
                EditorBlock(type = BlockType.Heading, text = "Your Name", level = 1),
                EditorBlock(type = BlockType.Text, text = "A short bio about yourself. What you do, what you care about."),
                EditorBlock(type = BlockType.Divider),
                EditorBlock(type = BlockType.Heading, text = "Links", level = 2),
                EditorBlock(type = BlockType.Link, text = "GitHub", href = "https://github.com/you"),
                EditorBlock(type = BlockType.Link, text = "Twitter", href = "https://twitter.com/you"),
                EditorBlock(type = BlockType.Link, text = "Email", href = "mailto:you@example.com"),
            ),
            theme = themed("#4dabf7"),
        ),
        SiteTemplate(
            id = "blog",
            name = "Blog",
            description = "Blog post with title, date, and content",
            preview = "B",
            blocks = listOf(
                EditorBlock(type = BlockType.Heading, text = "Blog Post Title", level = 1),
                EditorBlock(type = BlockType.Text, text = "Published on April 2026"),
                EditorBlock(type = BlockType.Divider),
                EditorBlock(type = BlockType.Text, text = "Your blog post content goes here. Write about anything."),
                EditorBlock(type = BlockType.Quote, text = "A meaningful quote that supports your argument."),
                EditorBlock(type = BlockType.Text, text = "Wrap up your post with a conclusion."),
            ),
            theme = themed("#ff9500", fontFamily = "Georgia, serif"),
        ),
        SiteTemplate(
            id = "portfolio",
            name = "Portfolio",
            description = "Showcase your work with sections",
            preview = "P",
            blocks = listOf(
                EditorBlock(type = BlockType.Heading, text = "Your Name — Portfolio", level = 1),
                EditorBlock(type = BlockType.Text, text = "Designer / Developer / Creator"),
                EditorBlock(type = BlockType.Divider),
                EditorBlock(type = BlockType.Heading, text = "Project 1", level = 2),
                EditorBlock(type = BlockType.Text, text = "Description of your first project."),
                EditorBlock(type = BlockType.Link, text = "View Project", href = "https://example.com"),
                EditorBlock(type = BlockType.Divider),
                EditorBlock(type = BlockType.Heading, text = "Contact", level = 2),
                EditorBlock(type = BlockType.Link, text = "Email me", href = "mailto:you@example.com"),
            ),
            theme = themed("#4ade80"),
        ),
        SiteTemplate(
            id = "landing",
            name = "Landing",
            description = "Simple product / idea landing page",
            preview = "L",
            blocks = listOf(
                EditorBlock(type = BlockType.Heading, text = "Your Product", level = 1),
                EditorBlock(type = BlockType.Text, text = "A one-line pitch that sells the idea."),
                EditorBlock(type = BlockType.Divider),
                EditorBlock(type = BlockType.Heading, text = "Why it matters", level = 2),
                EditorBlock(type = BlockType.Text, text = "Three sentences of context."),
                EditorBlock(type = BlockType.Link, text = "Get Started", href = "https://example.com"),
            ),
            theme = themed("#facc15"),
        ),
    )

    fun byId(id: String): SiteTemplate = all.firstOrNull { it.id == id } ?: all.first()
}

@Composable
fun TemplatePickerScreen(
    onSelect: (SiteTemplate) -> Unit,
    onBack: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(PearColors.Bg)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) {
                Text("< Back", color = PearColors.Accent, fontSize = 14.sp)
            }
            Text(
                "Pick a template",
                color = PearColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(
                "Start with a template or pick Blank to build from scratch.",
                color = PearColors.TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))
            SiteTemplates.all.forEach { template ->
                TemplateCard(template = template, onClick = { onSelect(template) })
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun TemplateCard(template: SiteTemplate, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(PearColors.Surface, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .size(56.dp)
                .background(PearColors.SurfaceElevated, RoundedCornerShape(12.dp)),
        ) {
            Text(
                template.preview,
                color = PearColors.Accent,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                template.name,
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(template.description, color = PearColors.TextSecondary, fontSize = 12.sp)
        }
        Text(">", color = PearColors.TextMuted, fontSize = 18.sp)
    }
}
