package hu.privateplace.app.domain

const val SELF_COLOR_KEY = "self"
data class PersonColorOption(val value: String, val name: String)
val PERSON_COLOR_OPTIONS: List<PersonColorOption> =
    SELECTION_COLORS.map { (k, v) -> PersonColorOption(v, COLOR_NAMES.getValue(k)) } + listOf(
        PersonColorOption("#FB923C", "Mandarin"), PersonColorOption("#A3E635", "Lime"),
        PersonColorOption("#F472B6", "Rózsaszín"), PersonColorOption("#E2E8F0", "Gyöngyház"))
private val ID_PATTERN = Regex("^(self|[A-Za-z0-9_-]{8,64})$")
fun isPersonColor(v: String?) = v != null && PERSON_COLOR_OPTIONS.any { it.value.equals(v, true) }
fun setPersonColor(c: Map<String, String>, id: String, color: String?): Map<String, String> {
    if (!ID_PATTERN.matches(id)) return c
    if (color == null) return if (id in c) c - id else c
    if (!isPersonColor(color) || c[id] == color) return c
    val next = LinkedHashMap(c); next.remove(id); next[id] = color
    while (next.size > 500) next.remove(next.keys.first())
    return next
}
