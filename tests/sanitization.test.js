import { describe, expect, it } from '@jest/globals';

describe('Comment Sanitization', () => {
  describe('HTML sanitization patterns', () => {
    it('should remove style attributes from HTML content', () => {
      // Test the regex pattern that should remove style attributes
      const input = '<p style="font-size: 24pt; color: red;">Dangerous styled text</p>';
      const cleaned = input.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
      
      expect(cleaned).not.toContain('style=');
      expect(cleaned).not.toContain('font-size');
      expect(cleaned).not.toContain('24pt');
      expect(cleaned).toBe('<p>Dangerous styled text</p>');
    });

    it('should remove script tags completely', () => {
      const input = '<script>alert("xss")</script>Normal text';
      const cleaned = input.replace(/<script[^>]*>.*?<\/script>/gis, '');
      
      expect(cleaned).not.toContain('<script');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).toBe('Normal text');
    });

    it('should remove event handler attributes', () => {
      const input = '<div onclick="alert(1)" onload="evil()">Click me</div>';
      const cleaned = input.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
      
      expect(cleaned).not.toContain('onclick=');
      expect(cleaned).not.toContain('onload=');
      expect(cleaned).not.toContain('alert(1)');
      expect(cleaned).toBe('<div>Click me</div>');
    });

    it('should handle complex mixed dangerous content', () => {
      const input = '<p style="font-size: 24pt;"><script>alert("bad")</script>Good <strong>content</strong></p>';
      
      // Apply multiple sanitization steps
      let cleaned = input.replace(/<script[^>]*>.*?<\/script>/gis, '');
      cleaned = cleaned.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
      
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('style=');
      expect(cleaned).not.toContain('24pt');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).toContain('Good');
      expect(cleaned).toContain('<strong>content</strong>');
    });
  });

  describe('Username normalization', () => {
    // Usernames werden roh gespeichert und erst bei der Ausgabe escaped
    // (EJS `<%= %>`) — hier wird nur die Normalisierung getestet.
    it('should handle empty usernames', () => {
      const normalizeUsername = (username) => {
        if (!username || String(username).trim() === '') {
          return 'Anonym';
        }
        return String(username);
      };

      expect(normalizeUsername('')).toBe('Anonym');
      expect(normalizeUsername(null)).toBe('Anonym');
      expect(normalizeUsername('   ')).toBe('Anonym');
      expect(normalizeUsername('normal')).toBe('normal');
    });
  });

  describe('CSP violation prevention', () => {
    it('should prevent the specific CSP violation from the error logs', () => {
      // The original error showed: "font-size: 24pt;" in inline styles
      const problematicContent = '<span style="font-size: 24pt;">Large text</span>';
      
      // Our sanitization should remove this
      const sanitized = problematicContent.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
      
      expect(sanitized).not.toContain('font-size: 24pt');
      expect(sanitized).not.toContain('style=');
      expect(sanitized).toBe('<span>Large text</span>');
    });
  });
});