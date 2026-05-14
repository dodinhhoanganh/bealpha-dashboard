/**
 * Unit tests for Input Sanitization
 */

import {
  escapeHtml,
  stripHtml,
  sanitizeString,
  sanitizeEmail,
  sanitizeUrl,
  sanitizeUuid,
  sanitizeNumber,
  sanitizePagination,
  sanitizeObject,
  sanitizeSearchQuery,
} from "@/lib/sanitize";

describe("Sanitize — escapeHtml", () => {
  it("should escape HTML entities", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;&#x2F;script&gt;"
    );
  });

  it("should escape ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("should pass through safe text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

describe("Sanitize — stripHtml", () => {
  it("should remove all HTML tags", () => {
    expect(stripHtml("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  it("should strip nested tags", () => {
    expect(stripHtml("<div><p>hello</p></div>")).toBe("hello");
  });

  it("should handle script tags", () => {
    expect(stripHtml('<script>alert("x")</script>safe')).toBe('alert("x")safe');
  });

  it("should trim whitespace", () => {
    expect(stripHtml("  <br>  ")).toBe("");
  });
});

describe("Sanitize — sanitizeString", () => {
  it("should trim whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("should remove null bytes", () => {
    expect(sanitizeString("hel\0lo")).toBe("hello");
  });

  it("should remove control characters", () => {
    expect(sanitizeString("he\x01l\x02lo")).toBe("hello");
  });

  it("should keep newlines and tabs", () => {
    expect(sanitizeString("line1\nline2\ttab")).toBe("line1\nline2\ttab");
  });

  it("should truncate to max length", () => {
    const long = "a".repeat(2000);
    expect(sanitizeString(long, 100)).toHaveLength(100);
  });

  it("should return empty string for non-string input", () => {
    expect(sanitizeString(123)).toBe("");
    expect(sanitizeString(null)).toBe("");
    expect(sanitizeString(undefined)).toBe("");
  });
});

describe("Sanitize — sanitizeEmail", () => {
  it("should accept valid emails", () => {
    expect(sanitizeEmail("user@example.com")).toBe("user@example.com");
  });

  it("should lowercase emails", () => {
    expect(sanitizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  it("should reject invalid emails", () => {
    expect(sanitizeEmail("not-an-email")).toBe("");
    expect(sanitizeEmail("@missing.local")).toBe("");
    expect(sanitizeEmail("spaces in@email.com")).toBe("");
  });

  it("should return empty for non-string", () => {
    expect(sanitizeEmail(123)).toBe("");
  });
});

describe("Sanitize — sanitizeUrl", () => {
  it("should accept valid http/https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
    expect(sanitizeUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("should reject non-http protocols", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("ftp://files.com")).toBe("");
    expect(sanitizeUrl("data:text/html,<h1>hi</h1>")).toBe("");
  });

  it("should reject invalid URLs", () => {
    expect(sanitizeUrl("not a url")).toBe("");
    expect(sanitizeUrl("")).toBe("");
  });
});

describe("Sanitize — sanitizeUuid", () => {
  it("should accept valid UUIDs", () => {
    expect(sanitizeUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
  });

  it("should reject invalid UUIDs", () => {
    expect(sanitizeUuid("not-a-uuid")).toBe("");
    expect(sanitizeUuid("550e8400")).toBe("");
    expect(sanitizeUuid(123)).toBe("");
  });
});

describe("Sanitize — sanitizeNumber", () => {
  it("should parse valid numbers", () => {
    expect(sanitizeNumber("42")).toBe(42);
    expect(sanitizeNumber(42)).toBe(42);
  });

  it("should clamp to min/max", () => {
    expect(sanitizeNumber("200", 0, 100)).toBe(100);
    expect(sanitizeNumber("-5", 0, 100)).toBe(0);
  });

  it("should return default for NaN", () => {
    expect(sanitizeNumber("not-a-number", 0, 100, 50)).toBe(50);
    expect(sanitizeNumber(undefined)).toBe(0);
  });
});

describe("Sanitize — sanitizePagination", () => {
  it("should return defaults for missing params", () => {
    expect(sanitizePagination({})).toEqual({ page: 1, limit: 20 });
  });

  it("should parse valid pagination", () => {
    expect(sanitizePagination({ page: "3", limit: "50" })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it("should clamp limit to 100", () => {
    expect(sanitizePagination({ page: "1", limit: "500" })).toEqual({
      page: 1,
      limit: 100,
    });
  });

  it("should enforce minimum page 1", () => {
    expect(sanitizePagination({ page: "0" })).toEqual({ page: 1, limit: 20 });
  });
});

describe("Sanitize — sanitizeObject", () => {
  it("should strip HTML from string values", () => {
    const result = sanitizeObject({
      name: "<b>John</b>",
      bio: '<script>alert("xss")</script>Bio text',
    });
    expect(result.name).toBe("John");
    expect(result.bio).not.toContain("<script>");
  });

  it("should not modify non-string values", () => {
    const result = sanitizeObject({ count: 42 as unknown as string, active: true as unknown as string });
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });

  it("should handle nested objects", () => {
    const result = sanitizeObject({
      meta: { title: "<b>Title</b>" } as unknown,
    });
    expect((result.meta as Record<string, string>).title).toBe("Title");
  });
});

describe("Sanitize — sanitizeSearchQuery", () => {
  it("should remove special characters", () => {
    expect(sanitizeSearchQuery("test%query_with*special")).toBe("testquerywithspecial");
  });

  it("should keep normal text", () => {
    expect(sanitizeSearchQuery("Hello World 123")).toBe("Hello World 123");
  });

  it("should truncate long queries", () => {
    const long = "a".repeat(500);
    expect(sanitizeSearchQuery(long, 100)).toHaveLength(100);
  });
});
