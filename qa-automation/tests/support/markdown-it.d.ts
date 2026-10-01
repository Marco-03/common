declare module "markdown-it" {
  export default class MarkdownIt {
    constructor(options?: { html?: boolean });
    parse(text: string, environment: object): Array<{ type: string; map: [number, number] | null }>;
  }
}
