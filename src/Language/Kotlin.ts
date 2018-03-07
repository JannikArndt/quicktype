import { TargetLanguage } from "../TargetLanguage";
import {
    Type,
    ClassType,
    EnumType,
    UnionType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
    TypeKind,
    ClassProperty
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Option, EnumOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    isLetterOrUnderscore,
    isNumeric,
    isDigit,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    intToHex,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";

enum Framework {
    None,
    Klaxon
}

export default class KotlinTargetLanguage extends TargetLanguage {
    private readonly _frameworkOption = new EnumOption("framework", "Serialization framework", [
        ["klaxon", Framework.Klaxon],
        ["none", Framework.None]
    ]);

    constructor() {
        super("Kotlin", ["kotlin"], "kt");
    }

    protected getOptions(): Option<any>[] {
        return [this._frameworkOption];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return KotlinRenderer;
    }
}

const keywords = [
    "associatedtype",
    "class",
    "deinit",
    "enum",
    "extension",
    "fileprivate",
    "func",
    "import",
    "init",
    "inout",
    "internal",
    "let",
    "open",
    "operator",
    "private",
    "protocol",
    "public",
    "static",
    "struct",
    "subscript",
    "typealias",
    "var",
    "break",
    "case",
    "continue",
    "default",
    "defer",
    "do",
    "else",
    "fallthrough",
    "for",
    "guard",
    "if",
    "in",
    "repeat",
    "return",
    "switch",
    "where",
    "while",
    "as",
    "Any",
    "catch",
    "false",
    "is",
    "nil",
    "rethrows",
    "super",
    "self",
    "Self",
    "throw",
    "throws",
    "true",
    "try",
    "_",
    "associativity",
    "convenience",
    "dynamic",
    "didSet",
    "final",
    "get",
    "infix",
    "indirect",
    "lazy",
    "left",
    "mutating",
    "nonmutating",
    "optional",
    "override",
    "postfix",
    "precedence",
    "prefix",
    "Protocol",
    "required",
    "right",
    "set",
    "Type",
    "unowned",
    "weak",
    "willSet",
    "String",
    "Int",
    "Double",
    "Bool",
    "Data",
    "CommandLine",
    "FileHandle",
    "JSONSerialization",
    "checkNull",
    "removeNSNull",
    "nilToNSNull",
    "convertArray",
    "convertOptional",
    "convertDict",
    "convertDouble",
    "jsonString",
    "jsonData"
];

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function kotlinNameStyle(isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

const upperNamingFunction = funPrefixNamer("upper", s => kotlinNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => kotlinNameStyle(false, s));

class KotlinRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, leadingComments: string[] | undefined, private readonly _framework: Framework) {
        super(graph, leadingComments);
    }

    get _justTypes() {
        return this._framework === Framework.None;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return kotlinNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForClassProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("upper", s => kotlinNameStyle(true, s) + "Value");
    }

    protected makeEnumCaseNamer(): Namer {
        return upperNamingFunction;
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    private emitBlock = (line: Sourcelike, f: () => void, delimiter: "curly" | "paren" = "curly"): void => {
        const [open, close] = delimiter === "curly" ? ["{", "}"] : ["(", ")"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    };

    private kotlinType = (t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike => {
        const optional = noOptional ? "" : "?";
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, ["Any", optional]);
            },
            _nullType => {
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, ["Any", optional]);
            },
            _boolType => "Boolean",
            _integerType => "Int",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["List<", this.kotlinType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return [this.kotlinType(nullable, withIssues), optional];
                return this.nameForNamedType(unionType);
            }
        );
    };

    private toJsonString = (t: Type, e: Sourcelike): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => "",
            _nullType => `"null"`,
            _boolType => [e, `.toString()`],
            _integerType => [e, `.toString()`],
            _doubleType => [e, `.toString()`],
            _stringType => e,
            _arrayType => `"[]"`, // ["List<", this.kotlinType(arrayType.items, withIssues), ">"],
            // _classType => ["klaxon.toJsonString(", e, ", as Any)"],
            _classType => [e, `.toJson()`],
            _mapType => `"{}"`, // ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"],
            _enumType => `"FIXME"`, // this.nameForNamedType(enumType),
            _unionType => `"FIXME"`
        );
    };

    private fromJsonValue = (t: Type, e: Sourcelike): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => "false",
            _nullType => "false",
            _boolType => e,
            _integerType => e,
            _doubleType => e,
            _stringType => e,
            _arrayType => "false", // ["List<", this.kotlinType(arrayType.items, withIssues), ">"],
            // _classType => ["klaxon.toJsonString(", e, ", as Any)"],
            _classType => "false",
            _mapType => "false", // ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"],
            _enumType => "false", // this.nameForNamedType(enumType),
            _unionType => "false"
        );
    };

    private toJsonValueGuard = (t: Type, _e: Sourcelike): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => "is Any",
            _nullType => "is Any",
            _boolType => "is Bool",
            _integerType => "is Int",
            _doubleType => "is Any",
            _stringType => "is String",
            _arrayType => "is Any", // ["List<", this.kotlinType(arrayType.items, withIssues), ">"],
            // _classType => ["klaxon.toJsonString(", e, ", as Any)"],
            _classType => "is Any",
            _mapType => "is Any", // ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"],
            _enumType => "is Any", // this.nameForNamedType(enumType),
            _unionType => "is Any"
        );
    };

    private shouldOmit(t: Type) {
        return (
            this._framework === Framework.Klaxon &&
            matchType<boolean>(
                t,
                _anyType => false,
                _nullType => false,
                _boolType => false,
                _integerType => false,
                _doubleType => false,
                _stringType => false,
                arrayType => this.shouldOmit(arrayType.items),
                _classType => false,
                mapType => this.shouldOmit(mapType.values),
                _enumType => false,
                unionType => {
                    const nullable = nullableFromUnion(unionType);
                    return nullable === null ? true : this.shouldOmit(nullable);
                }
            )
        );
    }

    protected proposedUnionMemberNameForTypeKind = (kind: TypeKind): string | null => {
        if (kind === "enum") {
            return "enumeration";
        }
        if (kind === "union") {
            return "one_of";
        }
        return null;
    };

    private renderHeader = (): void => {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._justTypes) {
            this.emitLine("// To parse the JSON, add this file to your project and do:");
            this.emitLine("//");
            this.forEachTopLevel("none", (_, name) => {
                this.emitLine("//   val ", modifySource(camelCase, name), " = ", name, ".fromJson(jsonString)");
            });
        }
        this.ensureBlankLine();

        if (this._framework === Framework.Klaxon) {
            this.emitLine("import com.beust.klaxon.*");
        }
    };

    private renderTopLevelAlias = (t: Type, name: Name): void => {
        this.emitLine("typealias ", name, " = ", this.kotlinType(t, true));
    };

    private klaxonRenameAttribute(propName: Name, jsonName: string, ignore: boolean = false): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties: Sourcelike[] = [];
        if (namesDiffer) {
            properties.push(['name = "', escapedName, '"']);
        }
        if (ignore) {
            properties.push("ignored = true");
        }
        return properties.length === 0 ? undefined : ["@Json(", properties.join(", "), ")"];
    }

    private renderClassDefinition = (c: ClassType, className: Name): void => {
        const kotlinType = (p: ClassProperty) => {
            if (p.isOptional) {
                return [this.kotlinType(p.type, true, true), "?"];
            } else {
                return this.kotlinType(p.type, true);
            }
        };

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("data class ", className, " (");
        this.indent(() => {
            let count = c.properties.count();
            let first = true;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const nullable = p.isOptional || p.type.kind === "null";
                const last = --count === 0;
                let meta: Array<() => void> = [];

                const description = this.descriptionForClassProperty(c, jsonName);
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }

                const omit = this.shouldOmit(p.type);

                if (this._framework === Framework.Klaxon) {
                    const rename = this.klaxonRenameAttribute(name, jsonName, omit);
                    if (omit) {
                        meta.push(() => this.emitLine("// Due to limitations in Klaxon, this property is ignored"));
                    }
                    if (rename !== undefined) {
                        meta.push(() => this.emitLine(omit ? "// " : "", rename));
                    }
                }

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }

                this.emitLine(
                    omit ? "// " : "",
                    "val ",
                    name,
                    ": ",
                    kotlinType(p),
                    nullable ? " = null" : "",
                    last ? "" : ","
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });
        if (this._framework === Framework.Klaxon) {
            this.emitBlock(")", () => {
                this.emitLine("public fun toJson() = klaxon.toJsonString(this as Any)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("public fun fromJson(json: String) = klaxon.parse<", className, ">(json)");
                });
            });
        } else {
            this.emitLine(")");
        }
    };

    private renderEnumConverter = (e: EnumType, enumName: Name): void => {
        this.emitBlock(["val convert", enumName, " = object: Converter<", enumName, ">"], () => {
            this.emitBlock(["override fun toJson(value: ", enumName, "): String? = when (value)"], () => {
                let table: Sourcelike[][] = [];
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    table.push([[enumName, ".", name], [" -> ", `"${stringEscape(jsonName)}"`]]);
                });
                table.push(["else", " -> null"]);
                this.emitTable(table);
            });
            this.ensureBlankLine();
            this.emitBlock(["override fun fromJson(jv: JsonValue): ", enumName, " = when (jv.inside)"], () => {
                let table: Sourcelike[][] = [];
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    table.push([`"${stringEscape(jsonName)}"`, [" -> ", enumName, ".", name]]);
                });
                table.push(["else", [` -> throw IllegalArgumentException("Invalid `, enumName, `")`]]);
                this.emitTable(table);
            });
        });
    };

    private renderUnionConverter = (u: UnionType, name: Name): void => {
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["val convert", name, " = object: Converter<", name, ">"], () => {
            this.emitBlock(["override fun toJson(value: ", name, "): String? = when (value)"], () => {
                const table: Sourcelike[][] = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                    // const csType = this.nullableCSType(t);
                    table.push([["is ", name, ".", fieldName], [" -> ", this.toJsonString(t, "value.value")]]);
                });
                this.emitTable(table);
                //  this.emitLine("else -> null");
            });
            this.ensureBlankLine();
            this.emitBlock(["override fun fromJson(jv: JsonValue): ", name], () => {
                this.emitLine("val x = jv.inside");
                this.emitBlock("return when (x)", () => {
                    const table: Sourcelike[][] = [];
                    this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
                        // const csType = this.nullableCSType(t);
                        table.push([
                            [this.toJsonValueGuard(t, "x")],
                            [" -> ", name, ".", fieldName, "(", this.fromJsonValue(t, "x"), ")"]
                        ]);
                    });
                    if (maybeNull !== null) {
                        table.push([["is null"], [" -> ", name, ".Null()"]]);
                    }
                    table.push([[`else`], [` -> throw IllegalArgumentException("Invalid `, name, `")`]]);
                    this.emitTable(table);
                });
            });
        });
    };

    private renderEnumDefinition = (e: EnumType, enumName: Name): void => {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(["enum class ", enumName], () => {
            let count = e.cases.count();
            this.forEachEnumCase(e, "none", name => {
                this.emitLine(name, --count === 0 ? "" : ",");
            });
        });
    };

    private renderUnionDefinition = (u: UnionType, unionName: Name): void => {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        this.emitBlock(["sealed class ", unionName], () => {
            let table: Sourcelike[][] = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                table.push([["class ", name, "(val value: ", this.kotlinType(t), ")"], [": ", unionName, "()"]]);
            });
            if (maybeNull !== null) {
                table.push([["class ", this.nameForUnionMember(u, maybeNull), "()"], [": ", unionName, "()"]]);
            }
            this.emitTable(table);
        });
    };

    protected emitSourceStructure(): void {
        this.renderHeader();

        if (this._framework === Framework.Klaxon) {
            this.forEachEnum("leading-and-interposing", (enumType, name) => {
                this.renderEnumConverter(enumType, name);
            });
            // this.forEachUnion("leading-and-interposing", (unionType, name) => {
            //     this.renderUnionConverter(unionType, name);
            // });
            this.ensureBlankLine();
            this.emitLine("private val klaxon =");
            this.indent(() => {
                this.emitLine("Klaxon()");
                this.indent(() => {
                    this.forEachEnum("none", (_, name) => {
                        this.emitLine(".converter(convert", name, ")");
                    });
                    // this.forEachUnion("none", (_, name) => {
                    //     this.emitLine(".converter(convert", name, ")");
                    // });
                });
            });
        }

        this.forEachTopLevel(
            "leading",
            this.renderTopLevelAlias,
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachNamedType(
            "leading-and-interposing",
            this.renderClassDefinition,
            this.renderEnumDefinition,
            this.renderUnionDefinition
        );
    }
}
