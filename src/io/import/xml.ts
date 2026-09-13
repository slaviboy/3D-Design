/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ImportError } from '../mesh/limits';

/*
 * A small, strict XML parser for COLLADA files. It runs where DOMParser doesn't exist (workers, Node), and it is safe
 * by construction: document type declarations with entities are refused, and only the five predefined entities and
 * numeric character references are expanded, so there is no entity expansion attack and no external entity access.
 */

export interface XmlElement {
  /** Tag name without a namespace prefix. */
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** The element's own text content (not its descendants'), entities decoded. */
  text: string;
}

const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16), whole);
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), whole);
    const replacement = PREDEFINED[body];
    if (replacement === undefined) throw new ImportError(`the XML uses an unknown entity &${body};`);
    return replacement;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

export function parseXml(text: string, options: { readonly maxElements: number }): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let count = 0;
  let i = 0;
  const length = text.length;
  const failAt = (message: string): never => {
    throw new ImportError(`the XML is not well formed (${message})`);
  };

  while (i < length) {
    const open = text.indexOf('<', i);
    const textEnd = open < 0 ? length : open;
    if (textEnd > i) {
      const current = stack.at(-1);
      const chunk = text.slice(i, textEnd);
      if (current) current.text += decodeEntities(chunk);
      else if (chunk.trim() !== '') failAt('text outside the root element');
    }
    if (open < 0) break;
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0) failAt('unterminated comment');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end < 0) failAt('unterminated CDATA section');
      const current = stack.at(-1);
      if (current) current.text += text.slice(open + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end < 0) failAt('unterminated processing instruction');
      i = end + 2;
    } else if (text.startsWith('<!DOCTYPE', open) || text.startsWith('<!doctype', open)) {
      let depth = 0;
      let j = open + 9;
      for (; j < length; j++) {
        const ch = text[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      const declaration = text.slice(open, j);
      if (/<!ENTITY/i.test(declaration))
        throw new ImportError('the XML declares entities, which are not allowed');
      i = j + 1;
    } else if (text.startsWith('</', open)) {
      const end = text.indexOf('>', open + 2);
      if (end < 0) failAt('unterminated end tag');
      const name = localName(text.slice(open + 2, end).trim());
      const current = stack.pop();
      if (current?.name !== name) failAt(`unexpected </${name}>`);
      i = end + 1;
    } else {
      // Start tag: name, attributes, optional self-closing slash.
      let j = open + 1;
      while (j < length && !/[\s/>]/.test(text[j] ?? '')) j++;
      const rawName = text.slice(open + 1, j);
      if (rawName === '') failAt('empty tag name');
      const attributes: Record<string, string> = {};
      let selfClosing = false;
      for (;;) {
        while (j < length && /\s/.test(text[j] ?? '')) j++;
        const ch = text[j];
        if (ch === undefined) failAt('unterminated start tag');
        if (ch === '>') {
          j++;
          break;
        }
        if (ch === '/') {
          if (text[j + 1] !== '>') failAt('stray slash in a tag');
          selfClosing = true;
          j += 2;
          break;
        }
        const nameStart = j;
        while (j < length && !/[\s=/>]/.test(text[j] ?? '')) j++;
        const attributeName = text.slice(nameStart, j);
        while (j < length && /\s/.test(text[j] ?? '')) j++;
        if (text[j] !== '=') failAt(`attribute ${attributeName} has no value`);
        j++;
        while (j < length && /\s/.test(text[j] ?? '')) j++;
        const quote = text[j];
        if (quote !== '"' && quote !== "'") failAt(`attribute ${attributeName} is not quoted`);
        const valueEnd = text.indexOf(quote ?? '"', j + 1);
        if (valueEnd < 0) failAt('unterminated attribute value');
        attributes[localName(attributeName)] = decodeEntities(text.slice(j + 1, valueEnd));
        j = valueEnd + 1;
      }
      if (++count > options.maxElements) {
        throw new ImportError(`the file has more than ${String(options.maxElements)} XML elements`);
      }
      const element: XmlElement = { name: localName(rawName), attributes, children: [], text: '' };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) failAt('more than one root element');
      else root = element;
      if (!selfClosing) stack.push(element);
      i = j;
    }
  }
  if (stack.length > 0) failAt(`<${stack.at(-1)?.name ?? ''}> is not closed`);
  if (!root) return failAt('no root element');
  return root;
}

export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

export function childrenNamed(element: XmlElement | undefined, name: string): XmlElement[] {
  return element ? element.children.filter((candidate) => candidate.name === name) : [];
}

/** Numbers from whitespace-separated text. Tokens that aren't numbers become NaN, which validation rejects. */
export function parseNumbers(text: string): number[] {
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/).map(Number);
}
