/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
"use strict";

import IWorkerContext = monaco.worker.IWorkerContext;

import {
  LanguageModelCache,
  getLanguageModelCache
} from "./languageModelCache";
import {
  SymbolInformation,
  SymbolKind,
  CompletionItem,
  Location,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  Definition,
  TextEdit,
  TextDocument,
  Diagnostic,
  DiagnosticSeverity,
  Range,
  CompletionItemKind,
  Hover,
  MarkedString,
  DocumentHighlight,
  DocumentHighlightKind,
  CompletionList,
  Position,
  FormattingOptions
} from "vscode-languageserver-types";
import { LanguageMode, Settings } from "./languageModes";
import {
  getWordAtText,
  startsWith,
  isWhitespaceOnly,
  repeat
} from "../utils/strings";
import { HTMLDocumentRegions } from "./embeddedSupport";

import * as TypescriptServices from "../lib/typescriptServices";
let test = TypescriptServices;
import { contents as libes6ts } from "../lib/lib-es6-ts";
import { contents as libdts } from "../lib/lib-ts";
import { IExtraLibs } from "../monaco.contribution";

export interface ScriptMode extends LanguageMode {
  findComponents(document: TextDocument): ComponentInfo[];
}
export interface ComponentInfo {
  name: string;
  props?: PropInfo[];
}
export interface PropInfo {
  name: string;
  doc?: string;
}

const FILE_NAME = "vscode://javascript/1.js";

const DEFAULT_LIB = {
  NAME: "defaultLib:lib.d.ts",
  CONTENTS: libdts
};

const ES6_LIB = {
  NAME: "defaultLib:lib.es6.d.ts",
  CONTENTS: libes6ts
};

const _extraLibs: { [fileName: string]: string } = Object.create(null);

const JS_WORD_REGEX = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;

export function getJavascriptMode(
  documentRegions: LanguageModelCache<HTMLDocumentRegions>,
  ctx?: IWorkerContext
): LanguageMode {
  let jsDocuments = getLanguageModelCache<TextDocument>(10, 60, document =>
    documentRegions.get(document).getEmbeddedDocument("javascript")
  );

  let compilerOptions: TypescriptServices.CompilerOptions = { allowJs: true }; // { allowNonTsExtensions: true, allowJs: true, lib: [ES6_LIB.NAME], target: ts.ScriptTarget.Latest, moduleResolution: ts.ModuleResolutionKind.Classic };
  let currentTextDocument: TextDocument;
  let scriptFileVersion: number = 0;
  function updateCurrentTextDocument(doc: TextDocument) {
    if (
      !currentTextDocument ||
      doc.uri !== currentTextDocument.uri ||
      doc.version !== currentTextDocument.version
    ) {
      currentTextDocument = jsDocuments.get(doc);
      scriptFileVersion++;
    }
  }
  const host: TypescriptServices.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => {
      let names = [FILE_NAME];
      let labs = (monaco.languages as any).vue.vueDefaults.getExtraLibs() as IExtraLibs;
      let keys = Object.keys(labs);
      names = names.concat(keys);
      return names;
    },
    getScriptKind: (fileName: string) => TypescriptServices.ScriptKind.JS,
    getScriptVersion: (fileName: string) => {
      if (fileName === FILE_NAME) {
        return String(scriptFileVersion);
      }
      return "1";
    },
    getScriptSnapshot: (fileName: string) => {
      let text = "";
      if (startsWith(fileName, "vscode:")) {
        if (fileName === FILE_NAME) {
          text = currentTextDocument.getText();
        }
      } else if (fileName === DEFAULT_LIB.NAME) {
        text = DEFAULT_LIB.CONTENTS;
      } else if (fileName === ES6_LIB.NAME) {
        text = ES6_LIB.CONTENTS;
      } else {
        let labs = (monaco.languages as any).vue.vueDefaults.getExtraLibs() as IExtraLibs;
        text = labs[fileName].content as string;
      }
      return {
        getText: (start, end) => text.substring(start, end),
        getLength: () => text.length,
        getChangeRange: () => void 0
      };
    },
    getCurrentDirectory: () => "",
    getDefaultLibFileName: options => ES6_LIB.NAME
  };

  let jsLanguageService = TypescriptServices.createLanguageService(host);

  let globalSettings: Settings = {};

  return {
    getId() {
      return "javascript";
    },
    configure(options: any) {
      globalSettings = options;
    },
    doValidation(document: TextDocument): Diagnostic[] {
      updateCurrentTextDocument(document);
      const syntaxDiagnostics = jsLanguageService.getSyntacticDiagnostics(
        FILE_NAME
      );
      const semanticDiagnostics = jsLanguageService.getSemanticDiagnostics(
        FILE_NAME
      );
      return syntaxDiagnostics.concat(semanticDiagnostics).map(
        (diag): Diagnostic => {
          return {
            range: convertRange(currentTextDocument, diag),
            severity: DiagnosticSeverity.Error,
            message: TypescriptServices.flattenDiagnosticMessageText(
              diag.messageText,
              "\n"
            )
          };
        }
      );
    },

    doComplete(document: TextDocument, position: Position): CompletionList {
      updateCurrentTextDocument(document);
      let offset = currentTextDocument.offsetAt(position);
      let completions = jsLanguageService.getCompletionsAtPosition(
        FILE_NAME,
        offset
      );
      if (!completions) {
        return { isIncomplete: false, items: [] };
      }
      let replaceRange = convertRange(
        currentTextDocument,
        getWordAtText(currentTextDocument.getText(), offset, JS_WORD_REGEX)
      );
      return {
        isIncomplete: false,
        items: completions.entries.map(entry => {
          return {
            uri: document.uri,
            position: position,
            label: entry.name,
            sortText: entry.sortText,
            kind: convertKind(entry.kind),
            textEdit: TextEdit.replace(replaceRange, entry.name),
            data: {
              // data used for resolving item details (see 'doResolve')
              languageId: "javascript",
              uri: document.uri,
              offset: offset
            }
          };
        })
      };
    },
    doResolve(document: TextDocument, item: CompletionItem): CompletionItem {
      updateCurrentTextDocument(document);
      let details = jsLanguageService.getCompletionEntryDetails(
        FILE_NAME,
        item.data.offset,
        item.label
      );
      if (details) {
        item.detail = TypescriptServices.displayPartsToString(
          details.displayParts
        );
        item.documentation = TypescriptServices.displayPartsToString(
          details.documentation
        );
        delete item.data;
      }
      return item;
    },
    doHover(document: TextDocument, position: Position): any {
      updateCurrentTextDocument(document);
      let info = jsLanguageService.getQuickInfoAtPosition(
        FILE_NAME,
        currentTextDocument.offsetAt(position)
      );
      if (info) {
        return info;
      }
      return null;
    },
    doSignatureHelp(document: TextDocument, position: Position) {
      updateCurrentTextDocument(document);
      let signHelp = jsLanguageService.getSignatureHelpItems(
        FILE_NAME,
        currentTextDocument.offsetAt(position)
      );
      return signHelp as any;
    },

    findDocumentHighlight(
      document: TextDocument,
      position: Position
    ): DocumentHighlight[] {
      updateCurrentTextDocument(document);
      let occurrences = jsLanguageService.getOccurrencesAtPosition(
        FILE_NAME,
        currentTextDocument.offsetAt(position)
      );
      if (occurrences) {
        return occurrences.map(entry => {
          return {
            range: convertRange(currentTextDocument, entry.textSpan),
            kind: <DocumentHighlightKind>(
              (entry.isWriteAccess
                ? DocumentHighlightKind.Write
                : DocumentHighlightKind.Text)
            )
          };
        });
      }
      return null;
    },
    findDocumentSymbols(document: TextDocument): SymbolInformation[] {
      updateCurrentTextDocument(document);
      let items = jsLanguageService.getNavigationBarItems(FILE_NAME);
      if (items) {
        let result: SymbolInformation[] = [];
        let existing = {};
        let collectSymbols = (
          item: TypescriptServices.NavigationBarItem,
          containerLabel?: string
        ) => {
          let sig = item.text + item.kind + item.spans[0].start;
          if (item.kind !== "script" && !existing[sig]) {
            let symbol: SymbolInformation = {
              name: item.text,
              kind: convertSymbolKind(item.kind),
              location: {
                uri: document.uri,
                range: convertRange(currentTextDocument, item.spans[0])
              },
              containerName: containerLabel
            };
            existing[sig] = true;
            result.push(symbol);
            containerLabel = item.text;
          }

          if (item.childItems && item.childItems.length > 0) {
            for (let child of item.childItems) {
              collectSymbols(child, containerLabel);
            }
          }
        };

        items.forEach(item => collectSymbols(item));
        return result;
      }
      return null;
    },
    findDefinition(document: TextDocument, position: Position): Definition {
      updateCurrentTextDocument(document);
      let definition = jsLanguageService.getDefinitionAtPosition(
        FILE_NAME,
        currentTextDocument.offsetAt(position)
      );
      if (definition) {
        return definition
          .filter(d => d.fileName === FILE_NAME)
          .map(d => {
            return {
              uri: document.uri,
              range: convertRange(currentTextDocument, d.textSpan)
            };
          });
      }
      return null;
    },
    findReferences(document: TextDocument, position: Position): Location[] {
      updateCurrentTextDocument(document);
      let references = jsLanguageService.getReferencesAtPosition(
        FILE_NAME,
        currentTextDocument.offsetAt(position)
      );
      if (references) {
        return references
          .filter(d => d.fileName === FILE_NAME)
          .map(d => {
            return {
              uri: document.uri,
              range: convertRange(currentTextDocument, d.textSpan)
            };
          });
      }
      return null;
    },
    format(
      document: TextDocument,
      range: Range,
      formatParams: FormattingOptions,
      settings: Settings = globalSettings
    ): TextEdit[] {
      currentTextDocument = documentRegions
        .get(document)
        .getEmbeddedDocument("javascript", true);
      scriptFileVersion++;

      let formatterSettings =
        settings && settings.javascript && settings.javascript.format;

      let initialIndentLevel = computeInitialIndent(
        document,
        range,
        formatParams
      );
      let formatSettings = convertOptions(
        formatParams,
        formatterSettings,
        initialIndentLevel + 1
      );
      let start = currentTextDocument.offsetAt(range.start);
      let end = currentTextDocument.offsetAt(range.end);
      let lastLineRange = null;
      if (
        range.end.character === 0 ||
        isWhitespaceOnly(
          currentTextDocument
            .getText()
            .substr(end - range.end.character, range.end.character)
        )
      ) {
        end -= range.end.character;
        lastLineRange = Range.create(
          Position.create(range.end.line, 0),
          range.end
        );
      }
      let edits = jsLanguageService.getFormattingEditsForRange(
        FILE_NAME,
        start,
        end,
        formatSettings
      );
      if (edits) {
        let result = [];
        for (let edit of edits) {
          if (
            edit.span.start >= start &&
            edit.span.start + edit.span.length <= end
          ) {
            result.push({
              range: convertRange(currentTextDocument, edit.span),
              newText: edit.newText
            });
          }
        }
        if (lastLineRange) {
          result.push({
            range: lastLineRange,
            newText: generateIndent(initialIndentLevel, formatParams)
          });
        }
        return result;
      }
      return null;
    },
    onDocumentRemoved(document: TextDocument) {
      jsDocuments.onDocumentRemoved(document);
    },
    dispose() {
      jsLanguageService.dispose();
      jsDocuments.dispose();
    }
  };
}

function convertRange(
  document: TextDocument,
  span: { start: number; length: number }
): Range {
  let startPosition = document.positionAt(span.start);
  let endPosition = document.positionAt(span.start + span.length);
  return Range.create(startPosition, endPosition);
}

function convertKind(kind: string): CompletionItemKind {
  switch (kind) {
    case "primitive type":
    case "keyword":
      return CompletionItemKind.Keyword;
    case "var":
    case "local var":
      return CompletionItemKind.Variable;
    case "property":
    case "getter":
    case "setter":
      return CompletionItemKind.Field;
    case "function":
    case "method":
    case "construct":
    case "call":
    case "index":
      return CompletionItemKind.Function;
    case "enum":
      return CompletionItemKind.Enum;
    case "module":
      return CompletionItemKind.Module;
    case "class":
      return CompletionItemKind.Class;
    case "interface":
      return CompletionItemKind.Interface;
    case "warning":
      return CompletionItemKind.File;
  }

  return CompletionItemKind.Property;
}

function convertSymbolKind(kind: string): SymbolKind {
  switch (kind) {
    case "var":
    case "local var":
    case "const":
      return SymbolKind.Variable;
    case "function":
    case "local function":
      return SymbolKind.Function;
    case "enum":
      return SymbolKind.Enum;
    case "module":
      return SymbolKind.Module;
    case "class":
      return SymbolKind.Class;
    case "interface":
      return SymbolKind.Interface;
    case "method":
      return SymbolKind.Method;
    case "property":
    case "getter":
    case "setter":
      return SymbolKind.Property;
  }
  return SymbolKind.Variable;
}

function convertOptions(
  options: FormattingOptions,
  formatSettings: any,
  initialIndentLevel: number
): TypescriptServices.FormatCodeOptions {
  return {
    ConvertTabsToSpaces: options.insertSpaces,
    TabSize: options.tabSize,
    IndentSize: options.tabSize,
    IndentStyle: TypescriptServices.IndentStyle.Smart,
    NewLineCharacter: "\n",
    BaseIndentSize: options.tabSize * initialIndentLevel,
    InsertSpaceAfterCommaDelimiter: Boolean(
      !formatSettings || formatSettings.insertSpaceAfterCommaDelimiter
    ),
    InsertSpaceAfterSemicolonInForStatements: Boolean(
      !formatSettings || formatSettings.insertSpaceAfterSemicolonInForStatements
    ),
    InsertSpaceBeforeAndAfterBinaryOperators: Boolean(
      !formatSettings || formatSettings.insertSpaceBeforeAndAfterBinaryOperators
    ),
    InsertSpaceAfterKeywordsInControlFlowStatements: Boolean(
      !formatSettings ||
        formatSettings.insertSpaceAfterKeywordsInControlFlowStatements
    ),
    InsertSpaceAfterFunctionKeywordForAnonymousFunctions: Boolean(
      !formatSettings ||
        formatSettings.insertSpaceAfterFunctionKeywordForAnonymousFunctions
    ),
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: Boolean(
      formatSettings &&
        formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis
    ),
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: Boolean(
      formatSettings &&
        formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets
    ),
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: Boolean(
      formatSettings &&
        formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces
    ),
    InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: Boolean(
      formatSettings &&
        formatSettings.insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces
    ),
    PlaceOpenBraceOnNewLineForControlBlocks: Boolean(
      formatSettings && formatSettings.placeOpenBraceOnNewLineForFunctions
    ),
    PlaceOpenBraceOnNewLineForFunctions: Boolean(
      formatSettings && formatSettings.placeOpenBraceOnNewLineForControlBlocks
    )
  };
}

function computeInitialIndent(
  document: TextDocument,
  range: Range,
  options: FormattingOptions
) {
  let lineStart = document.offsetAt(Position.create(range.start.line, 0));
  let content = document.getText();

  let i = lineStart;
  let nChars = 0;
  let tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === " ") {
      nChars++;
    } else if (ch === "\t") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}

function generateIndent(level: number, options: FormattingOptions) {
  if (options.insertSpaces) {
    return repeat(" ", level * options.tabSize);
  } else {
    return repeat("\t", level);
  }
}
