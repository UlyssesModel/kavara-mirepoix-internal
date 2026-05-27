import { tryParseToolCallsFromContent } from "../rehydrate";

describe("tryParseToolCallsFromContent", () => {
  it("should parse standard JSON tool calls", () => {
    const content = `{
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco",
    "unit": "celsius"
  }
}`;
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([
      {
        name: "get_weather",
        arguments: {
          location: "San Francisco",
          unit: "celsius"
        }
      }
    ]);
  });

  it("should parse multiple JSON tool calls", () => {
    const content = `{
  "name": "get_weather",
  "arguments": {
    "location": "San Francisco"
  }
}
{
  "name": "get_time",
  "arguments": {
    "timezone": "PST"
  }
}`;
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([
      {
        name: "get_weather",
        arguments: {
          location: "San Francisco"
        }
      },
      {
        name: "get_time",
        arguments: {
          timezone: "PST"
        }
      }
    ]);
  });

  it("should handle JSON with code fences", () => {
    const content = `\`\`\`json
{
  "name": "get_weather",
  "arguments": {
    "location": "New York"
  }
}
\`\`\``;
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([
      {
        name: "get_weather",
        arguments: {
          location: "New York"
        }
      }
    ]);
  });

  it("should return empty array for invalid content", () => {
    const content = "This is just plain text with no tool calls";
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([]);
  });

  it("should handle malformed JSON gracefully", () => {
    const content = `{
  "name": "get_weather",
  "arguments": {
    "location": "Malformed JSON
  }
}`;
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([]);
  });

  it("should handle empty content", () => {
    const content = "";
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([]);
  });

  it("should handle content with only whitespace", () => {
    const content = "   \n\t  ";
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([]);
  });

  it("should handle nested JSON objects", () => {
    const content = `{
  "name": "complex_tool",
  "arguments": {
    "nested": {
      "value": "test",
      "array": [1, 2, 3]
    }
  }
}`;
    
    const result = tryParseToolCallsFromContent(content);
    expect(result).toEqual([
      {
        name: "complex_tool",
        arguments: {
          nested: {
            value: "test",
            array: [1, 2, 3]
          }
        }
      }
    ]);
  });
});