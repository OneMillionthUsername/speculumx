import fs from 'fs';
import ejs from 'ejs';
import path from 'path';

test('readPost.ejs renders without throwing', () => {
  const viewPath = path.resolve(process.cwd(), 'views', 'readPost.ejs');
  const tmpl = fs.readFileSync(viewPath, 'utf8');

  const samplePost = {
    id: 59,
    title: 'Test Post',
    content: '<p>This is a <strong>test</strong> content with HTML.</p>',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ['test', 'sample'],
  };

  expect(() => {
    // Provide filename option so EJS include() calls resolve relative to the views directory
    const html = ejs.render(tmpl, { post: samplePost }, { filename: viewPath });
    expect(typeof html).toBe('string');
  }).not.toThrow();
});

test('readPost.ejs escapes raw title/comments but renders content HTML', () => {
  const viewPath = path.resolve(process.cwd(), 'views', 'readPost.ejs');
  const tmpl = fs.readFileSync(viewPath, 'utf8');

  // Rohdaten wie sie nach dem Refactor in der DB liegen
  const samplePost = {
    id: 60,
    slug: 'xss-test',
    title: 'Evil <script>alert(1)</script> & "quotes"',
    content: '<p>Intended <strong>HTML</strong></p>',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ['C&C'],
  };
  const comments = [{
    id: 1,
    text: 'Nasty <img src=x onerror=alert(1)> & "text"',
    username: 'O\'Brien & Co',
    created_at: new Date().toISOString(),
  }];

  const html = ejs.render(tmpl, {
    post: samplePost,
    comments,
    commentCount: comments.length,
    csrfToken: 'test-token',
    isAdmin: false,
    commentStatus: null,
    commentMessage: null,
  }, { filename: viewPath });

  // Titel: escaped, kein aktives Script
  expect(html).toContain('Evil &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  // Kommentar: escaped, kein aktives img-Tag
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img src=x onerror=alert(1)>');
  // Post-Content: bewusst rohes HTML (DOMPurify beim Schreiben)
  expect(html).toContain('<p>Intended <strong>HTML</strong></p>');
});
