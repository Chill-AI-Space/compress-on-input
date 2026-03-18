import { describe, it, expect } from 'vitest';
import { compressDomToMarkdown } from '../src/compressors/dom-to-markdown.js';

describe('compressDomToMarkdown', () => {
  it('converts headings to markdown', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- heading "Page Title" [level=1] [ref=e31]',
    });
    expect(result.text).toContain('# Page Title');
    expect(result.text).not.toContain('[ref=');
  });

  it('converts level 3 heading', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- heading "Section" [level=3] [ref=e5]',
    });
    expect(result.text).toBe('### Section');
  });

  it('converts links with URLs', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- link "Home" [ref=e10] [cursor=pointer]:\n  - /url: /\n  - img [ref=e11]',
    });
    expect(result.text).toContain('[Home](/)');
    expect(result.text).toContain('[e10]');
    expect(result.text).not.toContain('[cursor=pointer]');
  });

  it('converts buttons with refs', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- button "Submit" [ref=e42] [cursor=pointer]',
    });
    expect(result.text).toContain('[e42]');
    expect(result.text).toContain('button "Submit"');
  });

  it('handles disabled buttons', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- button "Select time" [disabled] [ref=e350]',
    });
    expect(result.text).toContain('[e350]');
    expect(result.text).toContain('(disabled)');
  });

  it('converts textbox with placeholder', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- textbox "Email" [ref=e345]:\n  - /placeholder: Your email',
    });
    expect(result.text).toContain('[e345]');
    expect(result.text).toContain('textbox "Email"');
    expect(result.text).toContain('Your email');
  });

  it('strips generic wrappers', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- generic [ref=e1]:\n  - generic [ref=e2]:\n    - heading "Hello" [level=1] [ref=e3]',
    });
    expect(result.text).toBe('# Hello');
    expect(result.text).not.toContain('generic');
  });

  it('strips footer/contentinfo', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- main [ref=e1]:\n  - heading "Content" [level=1] [ref=e2]\n- contentinfo [ref=e50]:\n  - link "Terms" [ref=e51] [cursor=pointer]:\n    - /url: /terms',
    });
    expect(result.text).toContain('# Content');
    expect(result.text).not.toContain('Terms');
  });

  it('handles strong text', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- paragraph [ref=e1]:\n  - text: Hello\n  - strong [ref=e2]: world\n  - text: !',
    });
    expect(result.text).toContain('**world**');
    expect(result.text).toContain('Hello');
  });

  it('converts tables to markdown', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: `- table [ref=e57]:
  - rowgroup [ref=e63]:
    - row "Name Type" [ref=e64]:
      - columnheader "Name" [ref=e65]:
        - button "Name" [ref=e66] [cursor=pointer]
      - columnheader "Type" [ref=e67]:
        - button "Type" [ref=e68] [cursor=pointer]
    - row "Alice Admin" [ref=e72]:
      - cell "Alice" [ref=e73]:
        - link "Alice" [ref=e74] [cursor=pointer]:
          - /url: /users/alice
      - cell "Admin" [ref=e75]`,
    });
    expect(result.text).toContain('| Name | Type |');
    expect(result.text).toContain('| --- | --- |');
    expect(result.text).toContain('Alice');
  });

  it('handles tabs', () => {
    const result = compressDomToMarkdown({
      type: 'text',
      text: '- tablist "Tabs" [ref=e42]:\n  - tab "Accounts" [selected] [ref=e43] [cursor=pointer]\n  - tab "Tags" [ref=e44] [cursor=pointer]',
    });
    expect(result.text).toContain('[e43]');
    expect(result.text).toContain('(selected)');
    expect(result.text).toContain('[e44]');
  });

  it('preserves the non-snapshot header sections', () => {
    const input = `### Page
- Page URL: https://example.com
- Page Title: Example
### Snapshot
\`\`\`yaml
- heading "Hello" [level=1] [ref=e1]
\`\`\``;
    const result = compressDomToMarkdown({ type: 'text', text: input });
    expect(result.text).toContain('### Page');
    expect(result.text).toContain('Page URL: https://example.com');
    expect(result.text).toContain('# Hello');
    expect(result.text).not.toContain('```yaml');
  });

  it('passes through non-text blocks', () => {
    const block = { type: 'image', data: 'abc' };
    expect(compressDomToMarkdown(block)).toBe(block);
  });

  it('returns original if conversion made it bigger', () => {
    const block = { type: 'text', text: 'hi' };
    const result = compressDomToMarkdown(block);
    expect(result).toBe(block);
  });

  it('achieves significant reduction on real-world DOM', () => {
    const realDom = `- generic [ref=e1]:
  - generic [ref=e7]:
    - generic [ref=e10]:
      - generic [ref=e12] [cursor=pointer]:
        - generic [ref=e13]:
          - generic [ref=e14]: Problem
          - heading "Your ATS gathers thousands of profiles, just collecting virtual dust." [level=3] [ref=e15]:
            - strong [ref=e16]: Your ATS gathers thousands of profiles,
            - strong [ref=e18]: just collecting virtual dust.
        - generic [ref=e19]:
          - generic [ref=e20]:
            - generic [ref=e21]: solution
            - paragraph [ref=e22]: Refine, filter, and identify top candidates.
          - generic [ref=e23]:
            - generic [ref=e24]: Impact
            - paragraph [ref=e25]:
              - text: Skillset enhances productivity through our
              - strong [ref=e26]: talent optimization engine
              - text: .
  - generic [ref=e74]:
    - generic [ref=e75]:
      - heading "We understand that people make all the difference." [level=1] [ref=e76]
      - heading "Skillset helps companies achieve their business objectives." [level=1] [ref=e77]
    - link "Solve your problem" [ref=e78] [cursor=pointer]:
      - /url: "#book"
      - generic [ref=e81]: Solve your problem
  - form "Book Form" [ref=e341]:
    - generic [ref=e342]:
      - generic [ref=e343]:
        - generic [ref=e344]: Email
        - textbox "Email" [ref=e345]:
          - /placeholder: Your email
      - generic [ref=e346]:
        - generic [ref=e347]: Company
        - textbox "Company" [ref=e348]:
          - /placeholder: Your company
    - button "Select time" [disabled] [ref=e350]
  - contentinfo [ref=e352]:
    - generic [ref=e355]: All rights reserved
    - link "Terms" [ref=e361] [cursor=pointer]:
      - /url: /terms`;

    const result = compressDomToMarkdown({ type: 'text', text: realDom });
    const reduction = 1 - result.text!.length / realDom.length;

    // Should achieve at least 40% reduction (much better than dom-cleanup's ~25%)
    expect(reduction).toBeGreaterThan(0.4);

    // Should preserve interactive refs
    expect(result.text).toContain('[e78]');
    expect(result.text).toContain('[e345]');
    expect(result.text).toContain('[e348]');
    expect(result.text).toContain('[e350]');

    // Should NOT have non-interactive refs
    expect(result.text).not.toContain('[ref=e1]');
    expect(result.text).not.toContain('[ref=e7]');

    // Should strip footer
    expect(result.text).not.toContain('Terms');
    expect(result.text).not.toContain('All rights reserved');

    // Should have markdown formatting
    expect(result.text).toContain('###');
    expect(result.text).toContain('**');

    // Should NOT have generic/role noise
    expect(result.text).not.toContain('generic');
    expect(result.text).not.toContain('[cursor=');
  });

  it('handles the GTM snapshot with table', () => {
    const gtmSnapshot = `### Open tabs
- 0: [Skillset](https://skillset.ae/)
- 1: (current) [Google Tag Manager](https://tagmanager.google.com/#/home)
### Page
- Page URL: https://tagmanager.google.com/#/home
- Page Title: Google Tag Manager
### Snapshot
\`\`\`yaml
- generic [ref=e5]:
  - generic [ref=e9]:
    - button "Back to Home" [ref=e11] [cursor=pointer]:
      - img "Tag Manager"
    - generic [ref=e12]:
      - generic [ref=e14]:
        - generic: Tag Manager
      - button "Switch products" [ref=e17] [cursor=pointer]:
        - img
  - generic [ref=e37]:
    - banner [ref=e38]:
      - navigation [ref=e41]:
        - tablist "Choose Account or Google tag" [ref=e42]:
          - tab "Accounts" [selected] [ref=e43] [cursor=pointer]
          - tab "Google tags" [ref=e44] [cursor=pointer]
      - button "Open menu filter" [ref=e48] [cursor=pointer]
      - button "Create Account" [ref=e49] [cursor=pointer]
    - generic [ref=e51]:
      - generic [ref=e52]:
        - generic [ref=e53]: skillset
      - table [ref=e57]:
        - rowgroup [ref=e63]:
          - row "Container Name Container Type Container ID" [ref=e64]:
            - columnheader "Container Name" [ref=e65]:
              - button "Container Name" [ref=e66] [cursor=pointer]
            - columnheader "Container Type" [ref=e67]:
              - button "Container Type" [ref=e68] [cursor=pointer]
            - columnheader "Container ID" [ref=e69]:
              - button "Container ID" [ref=e70] [cursor=pointer]
            - columnheader [ref=e71]
          - row "skillset candidates Web GTM-PBJM68LL" [ref=e72]:
            - cell "skillset candidates" [ref=e73]:
              - link "skillset candidates" [ref=e74] [cursor=pointer]:
                - /url: "#/container/accounts/6339269098/containers/243653940"
            - cell "Web" [ref=e75]
            - cell "GTM-PBJM68LL" [ref=e76]
            - cell [ref=e77]:
              - button [ref=e79] [cursor=pointer]
          - row "skillset.ae clients Web GTM-TWM9H2Z6" [ref=e80]:
            - cell "skillset.ae clients" [ref=e81]:
              - link "skillset.ae clients" [ref=e82] [cursor=pointer]:
                - /url: "#/container/accounts/6339269098/containers/243571296"
            - cell "Web" [ref=e83]
            - cell "GTM-TWM9H2Z6" [ref=e84]
            - cell [ref=e85]:
              - button [ref=e87] [cursor=pointer]
\`\`\``;

    const result = compressDomToMarkdown({ type: 'text', text: gtmSnapshot });

    // Should keep header sections
    expect(result.text).toContain('### Open tabs');
    expect(result.text).toContain('### Page');

    // Should have table
    expect(result.text).toContain('Container Name');
    expect(result.text).toContain('GTM-PBJM68LL');

    // Should have interactive refs
    expect(result.text).toContain('[e43]');  // tab
    expect(result.text).toContain('[e49]');  // Create Account button
    expect(result.text).toContain('[e74]');  // link in table

    // Should not have generic noise
    expect(result.text).not.toContain('generic');

    // Should be significantly smaller
    const reduction = 1 - result.text!.length / gtmSnapshot.length;
    expect(reduction).toBeGreaterThan(0.3);
  });
});
