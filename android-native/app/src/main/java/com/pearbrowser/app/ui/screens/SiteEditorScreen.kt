package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.ui.theme.PearColors
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * SiteEditorScreen — mirror of ios-native `SiteEditorScreen.swift`.
 *
 * The block model mirrors backend/site-manager.js `_renderBlocks` exactly —
 * the 8 types below are all the backend understands. Save goes through
 * CMD_UPDATE_SITE with `{ siteId, blocks, theme }`, which the backend routes
 * to `siteManager.buildFromBlocks` (see backend/index.js). The theme object
 * feeds `_renderThemeCss` (primaryColor / backgroundColor / textColor /
 * fontFamily).
 *
 * There is no GET_SITE_BLOCKS RPC — opening an existing site starts from a
 * fresh default outline and saving replaces the rendered homepage, exactly
 * like the iOS editor.
 */
enum class BlockType(val wire: String, val toolbarLabel: String) {
    Heading("heading", "H"),
    Text("text", "T"),
    List("list", "="),
    Divider("divider", "--"),
    Code("code", "{}"),
    Quote("quote", "\""),
    Link("link", "@"),
    Image("image", "Img"),
}

/** One editable block. Wire shape is `toJson()` — backend/site-manager.js. */
data class EditorBlock(
    val id: String = UUID.randomUUID().toString(),
    val type: BlockType,
    val text: String = "",
    val level: Int = 2,
    val items: List<String> = emptyList(),
    val href: String = "",
    val src: String = "",
    val alt: String = "",
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("type", type.wire)
        when (type) {
            BlockType.Heading -> {
                put("text", text)
                put("level", level)
            }
            BlockType.Text, BlockType.Code, BlockType.Quote -> put("text", text)
            BlockType.List -> putJsonArray("items") { items.forEach { add(it) } }
            BlockType.Link -> {
                put("text", text)
                put("href", href)
            }
            BlockType.Image -> {
                put("src", src)
                put("alt", alt)
            }
            BlockType.Divider -> Unit
        }
    }

    /** Fresh copy with a new id — used when instantiating template blocks. */
    fun instantiate(): EditorBlock = copy(id = UUID.randomUUID().toString())
}

/** Theme preset; keys feed backend/site-manager.js `_renderThemeCss`. */
data class SiteTheme(
    val id: String,
    val label: String,
    val primaryColor: String,
    val backgroundColor: String = "#0a0a0a",
    val textColor: String = "#e0e0e0",
    val fontFamily: String = "-apple-system, sans-serif",
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("primaryColor", primaryColor)
        put("backgroundColor", backgroundColor)
        put("textColor", textColor)
        put("fontFamily", fontFamily)
    }

    companion object {
        // Preset row mirrors iOS SiteEditorScreen's themes; swatch colors are
        // the Pear palette values for the same names.
        val presets = listOf(
            SiteTheme("default", "Default", "#ff9500"),
            SiteTheme("dark", "Dark", "#e0e0e0"),
            SiteTheme("warm", "Warm", "#f28c33"),
            SiteTheme("ocean", "Ocean", "#4dabf7"),
            SiteTheme("forest", "Forest", "#4ade80"),
        )
        val default = presets.first()
        fun byId(id: String?): SiteTheme = presets.firstOrNull { it.id == id } ?: default
    }
}

@Composable
fun SiteEditorScreen(
    siteId: String,
    siteName: String?,
    published: Boolean,
    templateId: String?,
    onBack: () -> Unit,
    onPreview: (String) -> Unit,
) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()
    val template = remember(templateId) { templateId?.let(SiteTemplates::byId) }

    val blocks = remember {
        mutableStateListOf<EditorBlock>().apply {
            val initial = template?.blocks.orEmpty()
            if (initial.isNotEmpty()) {
                addAll(initial.map { it.instantiate() })
            } else {
                // Default seed, mirrors iOS `seedDefault()`.
                add(EditorBlock(type = BlockType.Heading, text = siteName ?: "My Website", level = 1))
                add(EditorBlock(type = BlockType.Text, text = "Welcome to my P2P website."))
            }
        }
    }
    var theme by remember { mutableStateOf(template?.theme ?: SiteTheme.default) }
    var isPublished by remember { mutableStateOf(published) }
    var saving by remember { mutableStateOf(false) }
    var publishing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var publishResult by remember { mutableStateOf<String?>(null) }

    suspend fun saveBlocks() {
        val client = rpc ?: throw IllegalStateException("P2P engine is not connected yet")
        client.updateSite(
            siteId = siteId,
            blocks = JsonArray(blocks.map { it.toJson() }),
            theme = theme.toJson(),
        )
    }

    fun save() {
        if (saving) return
        saving = true
        errorMessage = null
        scope.launch {
            try {
                saveBlocks()
            } catch (e: Throwable) {
                errorMessage = "Save failed: ${e.message ?: "unknown error"}"
            } finally {
                saving = false
            }
        }
    }

    fun publish() {
        if (publishing) return
        publishing = true
        errorMessage = null
        scope.launch {
            try {
                saveBlocks()
                val client = rpc ?: throw IllegalStateException("P2P engine is not connected yet")
                val resp = client.publishSite(siteId)
                publishResult = resp["url"]?.jsonPrimitive?.contentOrNull
                    ?: resp["keyHex"]?.jsonPrimitive?.contentOrNull?.let { "hyper://$it" }
                isPublished = true
            } catch (e: Throwable) {
                errorMessage = "Publish failed: ${e.message ?: "unknown error"}"
            } finally {
                publishing = false
            }
        }
    }

    fun move(index: Int, delta: Int) {
        val target = index + delta
        if (target < 0 || target >= blocks.size) return
        val tmp = blocks[index]
        blocks[index] = blocks[target]
        blocks[target] = tmp
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg),
    ) {
        // Header: back, title + publish badge, Save / Publish (iOS ScreenHeader).
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
            Column(Modifier.weight(1f)) {
                Text(
                    siteName ?: "Editor",
                    color = PearColors.TextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
                PublishBadge(isPublished)
            }
            Text(
                if (saving) "…" else "Save",
                color = if (rpc == null || saving) PearColors.TextMuted else PearColors.Accent,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clickable(enabled = rpc != null && !saving) { save() }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
            )
            Text(
                if (publishing) "…" else "Publish",
                color = if (rpc == null || publishing) PearColors.TextMuted else PearColors.Accent,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clickable(enabled = rpc != null && !publishing) { publish() }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
            )
        }

        errorMessage?.let {
            Text(
                it,
                color = PearColors.Error,
                fontSize = 13.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2B0D0D))
                    .padding(12.dp),
            )
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            Spacer(Modifier.height(8.dp))
            ThemeRow(selected = theme, onSelect = { theme = it })
            Spacer(Modifier.height(10.dp))
            blocks.forEachIndexed { index, block ->
                BlockEditorCard(
                    block = block,
                    onChange = { blocks[index] = it },
                    onMove = { delta -> move(index, delta) },
                    onRemove = { blocks.removeAt(index) },
                )
                Spacer(Modifier.height(10.dp))
            }
            if (blocks.isEmpty()) {
                Text(
                    "No blocks yet — add one below.",
                    color = PearColors.TextMuted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            }
            Spacer(Modifier.height(120.dp))
        }

        BlockToolbar(onAdd = { type -> blocks.add(newBlock(type)) })
    }

    publishResult?.let { url ->
        AlertDialog(
            onDismissRequest = { publishResult = null },
            containerColor = PearColors.Surface,
            title = { Text("Site published", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = { Text("Live at $url", color = PearColors.TextSecondary, fontSize = 14.sp) },
            confirmButton = {
                TextButton(onClick = {
                    publishResult = null
                    onPreview(url)
                }) {
                    Text("View", color = PearColors.Accent, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { publishResult = null }) {
                    Text("OK", color = PearColors.TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun PublishBadge(published: Boolean) {
    Text(
        if (published) "Live" else "Draft",
        color = if (published) PearColors.Success else PearColors.TextMuted,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .background(
                if (published) Color(0xFF176345) else PearColors.SurfaceElevated,
                RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun ThemeRow(selected: SiteTheme, onSelect: (SiteTheme) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState())) {
        SiteTheme.presets.forEach { preset ->
            val active = preset.id == selected.id
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .background(
                        if (active) PearColors.Accent else PearColors.Surface,
                        CircleShape,
                    )
                    .clickable { onSelect(preset) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Spacer(
                    Modifier
                        .width(10.dp)
                        .height(10.dp)
                        .background(preset.swatch(), CircleShape),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    preset.label,
                    color = if (active) PearColors.Bg else PearColors.TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

private fun SiteTheme.swatch(): Color = when (id) {
    "default" -> PearColors.Accent
    "dark" -> Color.Black
    "warm" -> Color(0xFFF28C33)
    "ocean" -> PearColors.Link
    "forest" -> PearColors.Success
    else -> PearColors.Accent
}

private fun newBlock(type: BlockType): EditorBlock = when (type) {
    BlockType.Heading -> EditorBlock(type = type, text = "Heading")
    BlockType.List -> EditorBlock(type = type, items = listOf("Item 1"))
    BlockType.Link -> EditorBlock(type = type, text = "Link", href = "https://")
    else -> EditorBlock(type = type)
}

@Composable
private fun BlockEditorCard(
    block: EditorBlock,
    onChange: (EditorBlock) -> Unit,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(PearColors.Surface.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                block.type.wire.uppercase(),
                color = PearColors.TextMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.sp,
                modifier = Modifier.weight(1f),
            )
            BlockControl("↑") { onMove(-1) }
            BlockControl("↓") { onMove(1) }
            BlockControl("x", color = PearColors.Error, onClick = onRemove)
        }
        Spacer(Modifier.height(6.dp))
        when (block.type) {
            BlockType.Heading -> EditorTextField(
                value = block.text,
                onValueChange = { onChange(block.copy(text = it)) },
                placeholder = "Heading",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            BlockType.Text, BlockType.Code, BlockType.Quote -> EditorTextField(
                value = block.text,
                onValueChange = { onChange(block.copy(text = it)) },
                placeholder = block.type.wire.replaceFirstChar { it.uppercase() },
                fontSize = if (block.type == BlockType.Code) 13.sp else 14.sp,
                fontFamily = if (block.type == BlockType.Code) FontFamily.Monospace else null,
                modifier = Modifier.heightIn(min = 80.dp),
            )
            BlockType.List -> {
                block.items.forEachIndexed { itemIndex, item ->
                    EditorTextField(
                        value = item,
                        onValueChange = { updated ->
                            onChange(block.copy(
                                items = block.items.mapIndexed { i, old -> if (i == itemIndex) updated else old },
                            ))
                        },
                        placeholder = "Item",
                    )
                    Spacer(Modifier.height(6.dp))
                }
                Text(
                    "+ item",
                    color = PearColors.Accent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable { onChange(block.copy(items = block.items + "")) }
                        .padding(vertical = 4.dp),
                )
            }
            BlockType.Divider -> Spacer(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
                    .height(1.dp)
                    .background(PearColors.Border),
            )
            BlockType.Link -> {
                EditorTextField(
                    value = block.text,
                    onValueChange = { onChange(block.copy(text = it)) },
                    placeholder = "Label",
                )
                Spacer(Modifier.height(6.dp))
                EditorTextField(
                    value = block.href,
                    onValueChange = { onChange(block.copy(href = it)) },
                    placeholder = "https://…",
                    fontFamily = FontFamily.Monospace,
                    noCapitalize = true,
                )
            }
            BlockType.Image -> {
                EditorTextField(
                    value = block.src,
                    onValueChange = { onChange(block.copy(src = it)) },
                    placeholder = "Image URL",
                    fontFamily = FontFamily.Monospace,
                    noCapitalize = true,
                )
                Spacer(Modifier.height(6.dp))
                EditorTextField(
                    value = block.alt,
                    onValueChange = { onChange(block.copy(alt = it)) },
                    placeholder = "Alt text",
                )
            }
        }
    }
}

@Composable
private fun BlockControl(
    label: String,
    color: Color = PearColors.TextSecondary,
    onClick: () -> Unit,
) {
    Text(
        label,
        color = color,
        fontSize = 14.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
private fun BlockToolbar(onAdd: (BlockType) -> Unit) {
    Surface(color = PearColors.Surface.copy(alpha = 0.9f)) {
        Column {
            Spacer(
                Modifier
                    .fillMaxWidth()
                    .height(0.5.dp)
                    .background(PearColors.Border),
            )
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            ) {
                BlockType.entries.forEach { type ->
                    Text(
                        type.toolbarLabel,
                        color = PearColors.TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier
                            .padding(end = 6.dp)
                            .background(PearColors.SurfaceElevated, RoundedCornerShape(8.dp))
                            .clickable { onAdd(type) }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun EditorTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    fontSize: androidx.compose.ui.unit.TextUnit = 14.sp,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    noCapitalize: Boolean = false,
    modifier: Modifier = Modifier,
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = PearColors.TextMuted, fontSize = fontSize) },
        textStyle = TextStyle(
            color = PearColors.TextPrimary,
            fontSize = fontSize,
            fontWeight = fontWeight,
            fontFamily = fontFamily,
        ),
        keyboardOptions = KeyboardOptions(
            capitalization = if (noCapitalize) KeyboardCapitalization.None else KeyboardCapitalization.Sentences,
            autoCorrectEnabled = false,
        ),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = PearColors.Surface,
            unfocusedContainerColor = PearColors.Surface,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = PearColors.Accent,
            focusedTextColor = PearColors.TextPrimary,
            unfocusedTextColor = PearColors.TextPrimary,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}
