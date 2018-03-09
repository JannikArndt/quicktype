data class TopLevel(val json: String) {
    public fun toJson() = this.json
    companion object {
        public fun fromJson(json: String) = TopLevel(json)
    }
}
