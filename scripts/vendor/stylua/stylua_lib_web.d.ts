/* tslint:disable */
/* eslint-disable */

/**
 * If blocks should be allowed to have leading and trailing newline gaps.
 */
export enum BlockNewlineGaps {
    /**
     * Never allow leading or trailing newline gaps
     */
    Never = 0,
    /**
     * Preserve both leading and trailing newline gaps if present in input
     */
    Preserve = 1,
}

/**
 * When to use call parentheses
 */
export enum CallParenType {
    /**
     * Use call parentheses all the time
     */
    Always = 0,
    /**
     * Skip call parentheses when only a string argument is used.
     */
    NoSingleString = 1,
    /**
     * Skip call parentheses when only a table argument is used.
     */
    NoSingleTable = 2,
    /**
     * Skip call parentheses when only a table or string argument is used.
     */
    None = 3,
    /**
     * Keep call parentheses based on its presence in input code.
     */
    Input = 4,
}

/**
 * What mode to use if we want to collapse simple functions / guard statements
 */
export enum CollapseSimpleStatement {
    /**
     * Never collapse
     */
    Never = 0,
    /**
     * Collapse simple functions onto a single line
     */
    FunctionOnly = 1,
    /**
     * Collapse simple if guards onto a single line
     */
    ConditionalOnly = 2,
    /**
     * Collapse all simple statements onto a single line
     */
    Always = 3,
}

/**
 * The configuration to use when formatting.
 */
export class Config {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a new Config with the default values
     */
    static new(): Config;
    /**
     * Whether we should allow blocks to preserve leading and trailing newline gaps.
     * if set to [`BlockNewlineGaps::Never`] then newline gaps are never allowed at the start or end of blocks.
     * if set to [`BlockNewlineGaps::Preserve`] then newline gaps are preserved at the start and end of blocks.
     */
    block_newline_gaps: BlockNewlineGaps;
    /**
     * When to use call parentheses.
     * if call_parentheses is set to [`CallParenType::Always`] call parentheses is always applied.
     * if call_parentheses is set to [`CallParenType::NoSingleTable`] call parentheses is omitted when
     * function is called with only one string argument.
     * if call_parentheses is set to [`CallParenType::NoSingleTable`] call parentheses is omitted when
     * function is called with only one table argument.
     * if call_parentheses is set to [`CallParenType::None`] call parentheses is omitted when
     * function is called with only one table or string argument (same as no_call_parentheses).
     */
    call_parentheses: CallParenType;
    /**
     * Whether we should collapse simple structures like functions or guard statements
     * if set to [`CollapseSimpleStatement::None`] structures are never collapsed.
     * if set to [`CollapseSimpleStatement::FunctionOnly`] then simple functions (i.e., functions with a single laststmt) can be collapsed
     */
    collapse_simple_statement: CollapseSimpleStatement;
    /**
     * The approximate line length to use when printing the code.
     * This is used as a guide to determine when to wrap lines, but note
     * that this is not a hard upper bound.
     */
    column_width: number;
    /**
     * The type of indents to use.
     */
    indent_type: IndentType;
    /**
     * The width of a single indentation level.
     * If `indent_type` is set to [`IndentType::Spaces`], then this is the number of spaces to use.
     * If `indent_type` is set to [`IndentType::Tabs`], then this is used as a heuristic to guide when to wrap lines.
     */
    indent_width: number;
    /**
     * The type of line endings to use.
     */
    line_endings: LineEndings;
    /**
     * Whether to omit parentheses around function calls which take a single string literal or table.
     * This is added for adoption reasons only, and is not recommended for new work.
     */
    no_call_parentheses: boolean;
    /**
     * The style of quotes to use in string literals.
     */
    quote_style: QuoteStyle;
    /**
     * Configuration for the sort requires codemod
     */
    sort_requires: SortRequiresConfig;
    /**
     * Whether we should include a space between the function name and arguments.
     * * if space_after_function_names is set to [`SpaceAfterFunctionNames::Never`] a space is never used.
     * * if space_after_function_names is set to [`SpaceAfterFunctionNames::Definitions`] a space is used only for definitions.
     * * if space_after_function_names is set to [`SpaceAfterFunctionNames::Calls`] a space is used only for calls.
     * * if space_after_function_names is set to [`SpaceAfterFunctionNames::Always`] a space is used for both definitions and calls.
     */
    space_after_function_names: SpaceAfterFunctionNames;
    /**
     * The type of Lua syntax to parse.
     */
    syntax: LuaVersion;
}

/**
 * The type of indents to use when indenting
 */
export enum IndentType {
    /**
     * Indent using tabs (`\t`)
     */
    Tabs = 0,
    /**
     * Indent using spaces (` `)
     */
    Spaces = 1,
}

/**
 * The type of line endings to use at the end of a line
 */
export enum LineEndings {
    /**
     * Unix Line Endings (LF) - `\n`
     */
    Unix = 0,
    /**
     * Windows Line Endings (CRLF) - `\r\n`
     */
    Windows = 1,
}

/**
 * The Lua syntax version to use
 */
export enum LuaVersion {
    /**
     * Parse all syntax versions at the same time. This allows most general usage.
     * For overlapping syntaxes (e.g., Lua5.2 label syntax and Luau type assertions), select a
     * specific syntax version
     */
    All = 0,
    /**
     * Parse Lua 5.1 code
     */
    Lua51 = 1,
    /**
     * Parse Lua 5.2 code
     */
    Lua52 = 2,
    /**
     * Parse Lua 5.3 code
     */
    Lua53 = 3,
    /**
     * Parse Lua 5.4 code
     */
    Lua54 = 4,
    /**
     * Parse Luau code
     */
    Luau = 5,
    /**
     * Parse LuaJIT code
     */
    LuaJIT = 6,
    /**
     * Parse Cfx Lua code
     */
    CfxLua = 7,
}

/**
 * The type of verification to perform to validate that the output AST is still correct.
 */
export enum OutputVerification {
    /**
     * Reparse the generated output to detect any changes to code correctness.
     */
    Full = 0,
    /**
     * Perform no verification of the output.
     */
    None = 1,
}

/**
 * The style of quotes to use within string literals
 */
export enum QuoteStyle {
    /**
     * Use double quotes where possible, but change to single quotes if it produces less escapes
     */
    AutoPreferDouble = 0,
    /**
     * Use single quotes where possible, but change to double quotes if it produces less escapes
     */
    AutoPreferSingle = 1,
    /**
     * Always use double quotes in all strings
     */
    ForceDouble = 2,
    /**
     * Always use single quotes in all strings
     */
    ForceSingle = 3,
}

/**
 * An optional formatting range.
 * If provided, only content within these boundaries (inclusive) will be formatted.
 * Both boundaries are optional, and are given as byte offsets from the beginning of the file.
 */
export class Range {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a new formatting range from the given start and end point.
     * All content within these boundaries (inclusive) will be formatted.
     */
    static from_values(start?: number | null, end?: number | null): Range;
    get end(): number | undefined;
    set end(value: number | null | undefined);
    get start(): number | undefined;
    set start(value: number | null | undefined);
}

/**
 * Configuration for the Sort Requires codemod
 */
export class SortRequiresConfig {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static new(): SortRequiresConfig;
    set_enabled(enabled: boolean): SortRequiresConfig;
    /**
     * Whether the sort requires codemod is enabled
     */
    enabled: boolean;
}

/**
 * When to use spaces after function names
 */
export enum SpaceAfterFunctionNames {
    /**
     * Never use spaces after function names.
     */
    Never = 0,
    /**
     * Use spaces after function names only for function definitions.
     */
    Definitions = 1,
    /**
     * Use spaces after function names only for function calls.
     */
    Calls = 2,
    /**
     * Use spaces after function names in definitions and calls.
     */
    Always = 3,
}

export function formatCode(code: string, config: Config, range: Range | null | undefined, verify_output: OutputVerification): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_config_free: (a: number, b: number) => void;
    readonly __wbg_get_config_block_newline_gaps: (a: number) => number;
    readonly __wbg_get_config_call_parentheses: (a: number) => number;
    readonly __wbg_get_config_collapse_simple_statement: (a: number) => number;
    readonly __wbg_get_config_column_width: (a: number) => number;
    readonly __wbg_get_config_indent_type: (a: number) => number;
    readonly __wbg_get_config_indent_width: (a: number) => number;
    readonly __wbg_get_config_line_endings: (a: number) => number;
    readonly __wbg_get_config_no_call_parentheses: (a: number) => number;
    readonly __wbg_get_config_quote_style: (a: number) => number;
    readonly __wbg_get_config_sort_requires: (a: number) => number;
    readonly __wbg_get_config_space_after_function_names: (a: number) => number;
    readonly __wbg_get_config_syntax: (a: number) => number;
    readonly __wbg_get_range_end: (a: number) => number;
    readonly __wbg_get_range_start: (a: number) => number;
    readonly __wbg_get_sortrequiresconfig_enabled: (a: number) => number;
    readonly __wbg_range_free: (a: number, b: number) => void;
    readonly __wbg_set_config_block_newline_gaps: (a: number, b: number) => void;
    readonly __wbg_set_config_call_parentheses: (a: number, b: number) => void;
    readonly __wbg_set_config_collapse_simple_statement: (a: number, b: number) => void;
    readonly __wbg_set_config_column_width: (a: number, b: number) => void;
    readonly __wbg_set_config_indent_type: (a: number, b: number) => void;
    readonly __wbg_set_config_indent_width: (a: number, b: number) => void;
    readonly __wbg_set_config_line_endings: (a: number, b: number) => void;
    readonly __wbg_set_config_no_call_parentheses: (a: number, b: number) => void;
    readonly __wbg_set_config_quote_style: (a: number, b: number) => void;
    readonly __wbg_set_config_sort_requires: (a: number, b: number) => void;
    readonly __wbg_set_config_space_after_function_names: (a: number, b: number) => void;
    readonly __wbg_set_config_syntax: (a: number, b: number) => void;
    readonly __wbg_set_range_end: (a: number, b: number) => void;
    readonly __wbg_set_range_start: (a: number, b: number) => void;
    readonly __wbg_set_sortrequiresconfig_enabled: (a: number, b: number) => void;
    readonly __wbg_sortrequiresconfig_free: (a: number, b: number) => void;
    readonly config_new: () => number;
    readonly formatCode: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly range_from_values: (a: number, b: number) => number;
    readonly sortrequiresconfig_new: () => number;
    readonly sortrequiresconfig_set_enabled: (a: number, b: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
