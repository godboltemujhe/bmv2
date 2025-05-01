import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Encodes a quiz JSON string using a simple Base64 + prefix encoding
 * This provides basic security to prevent users from easily reading quiz answers
 * Enhanced with error handling for offline use and Unicode support (including Hindi text)
 */
export function encodeQuizData(jsonString: string): string {
  try {
    // Add a prefix to identify encoded content
    const prefix = "BMVQUIZ_ENCODED_";
    
    // Handle Unicode characters properly by converting to UTF-8 encoding first
    // This properly handles Hindi, Chinese, Japanese and other non-Latin scripts
    let encodedString;
    
    // Check if TextEncoder is available (modern browsers)
    if (typeof TextEncoder !== 'undefined') {
      try {
        // Convert to UTF-8 bytes first, then encode as Base64
        const encoder = new TextEncoder();
        const utf8Bytes = encoder.encode(jsonString);
        
        // Convert bytes to Base64 using a more compatible approach
        encodedString = btoa(
          Array.from(utf8Bytes)
            .map(byte => String.fromCharCode(byte))
            .join('')
        );
        
        return prefix + encodedString;
      } catch (encodingError) {
        console.error("TextEncoder error:", encodingError);
        // Fall through to the fallback approach
      }
    }
    
    // Fallback for older browsers: use encodeURIComponent which handles UTF-8 conversion for us
    const prefix2 = "BMVQUIZ_UTF8_";
    return prefix2 + encodeURIComponent(jsonString);
  } catch (error) {
    console.error("Encoding error:", error);
    // Last resort fallback
    const prefix = "BMVQUIZ_SIMPLE_";
    return prefix + encodeURIComponent(jsonString);
  }
}

/**
 * Tries to decode quiz data if it's in the encoded format
 * Returns the original string if it's not encoded
 * Enhanced with support for fallback encoding and Unicode characters (Hindi, etc.)
 */
export function decodeQuizData(data: string): string {
  try {
    // Handle empty or null input
    if (!data) {
      console.warn("Empty data passed to decodeQuizData");
      return "";
    }
    
    // Check for the UTF8-specific encoding format (handles Hindi and other Unicode scripts)
    const utf8Prefix = "BMVQUIZ_UTF8_";
    if (data.startsWith(utf8Prefix)) {
      // Simply use decodeURIComponent which handles UTF-8 properly
      try {
        const encoded = data.substring(utf8Prefix.length);
        return decodeURIComponent(encoded);
      } catch (error) {
        console.error("Error decoding UTF8 encoded data:", error);
        // Will try other methods below
      }
    }
    
    // Check if the string is in our standard encoded format
    const standardPrefix = "BMVQUIZ_ENCODED_";
    if (data.startsWith(standardPrefix)) {
      // Remove the prefix and decode from Base64
      const encoded = data.substring(standardPrefix.length);
      try {
        // Handle Base64 decoding
        const binaryString = atob(encoded);
        
        // Detect if this is likely a UTF-8 encoded binary string from TextEncoder
        const seemsUtf8Encoded = /[\x80-\xFF]/.test(binaryString);
        
        if (seemsUtf8Encoded && typeof Uint8Array !== 'undefined') {
          try {
            // Convert binary string to byte array
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Use TextDecoder to convert back from UTF-8
            if (typeof TextDecoder !== 'undefined') {
              const decoder = new TextDecoder('utf-8');
              return decoder.decode(bytes);
            }
          } catch (textDecoderError) {
            console.error("TextDecoder error:", textDecoderError);
            // Continue with the old method below
          }
        }
        
        // Old method - replace escape sequences
        const oldMethodResult = binaryString.replace(/_([0-9a-fA-F]+?)_/g, function(match, hex) {
          try {
            return unescape('%' + hex);
          } catch (e) {
            console.warn("Failed to unescape sequence:", match);
            return match;
          }
        });
        
        // If it looks like valid JSON, return it
        if ((oldMethodResult.startsWith('{') && oldMethodResult.endsWith('}')) || 
            (oldMethodResult.startsWith('[') && oldMethodResult.endsWith(']'))) {
          return oldMethodResult;
        }
        
        // Check if the string was actually just Base64-encoded JSON
        if ((binaryString.startsWith('{') && binaryString.endsWith('}')) || 
            (binaryString.startsWith('[') && binaryString.endsWith(']'))) {
          return binaryString;
        }
        
        // Default to the old method result
        return oldMethodResult;
        
      } catch (error) {
        console.error("Error decoding data with standard method:", error);
        // Will try other methods below
      }
    }
    
    // Check if it's in our fallback simple format
    const simplePrefix = "BMVQUIZ_SIMPLE_";
    if (data.startsWith(simplePrefix)) {
      // Remove the prefix and decode using URI decoding
      const encoded = data.substring(simplePrefix.length);
      try {
        return decodeURIComponent(encoded);
      } catch (error) {
        console.error("Error decoding data with simple method:", error);
        // Will try other methods below
      }
    }
    
    // Special case for JSON data that might be double-encoded
    try {
      // If it's JSON, try to parse and then stringify it to ensure it's valid JSON
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        return data; // It's already valid JSON, return as is
      }
    } catch {
      // Not valid JSON, continue with other checks
    }
    
    // If the data contains common Base64 characters and might be encoded
    if (/^[A-Za-z0-9+/=]+$/.test(data) && data.length > 20) {
      try {
        // Attempt to decode as raw Base64
        console.log("Attempting to decode what looks like raw Base64");
        const decoded = atob(data);
        
        // If it's UTF-8 encoded, try to decode it
        if (typeof Uint8Array !== 'undefined' && typeof TextDecoder !== 'undefined') {
          try {
            // Convert binary string to byte array
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
              bytes[i] = decoded.charCodeAt(i);
            }
            
            // Try to decode as UTF-8
            const decoder = new TextDecoder('utf-8');
            const utf8Decoded = decoder.decode(bytes);
            
            // If it looks like JSON, return the UTF-8 decoded version
            if ((utf8Decoded.startsWith('{') && utf8Decoded.endsWith('}')) || 
                (utf8Decoded.startsWith('[') && utf8Decoded.endsWith(']'))) {
              return utf8Decoded;
            }
          } catch (textDecoderError) {
            console.warn("UTF-8 decoding failed:", textDecoderError);
          }
        }
        
        // If the simple decode looks like JSON, return it
        if ((decoded.startsWith('{') && decoded.endsWith('}')) || 
            (decoded.startsWith('[') && decoded.endsWith(']'))) {
          return decoded;
        }
      } catch (e) {
        console.warn("Not valid Base64 data");
      }
    }
    
    // Last resort: Just try decodeURIComponent directly
    try {
      const decoded = decodeURIComponent(data);
      if ((decoded.startsWith('{') && decoded.endsWith('}')) || 
          (decoded.startsWith('[') && decoded.endsWith(']'))) {
        return decoded;
      }
    } catch {
      // Ignore this error
    }
    
    // If it's not encoded, return as is
    return data;
  } catch (error) {
    console.error("Unexpected error during decoding:", error);
    return data;
  }
}

/**
 * Checks if a string is in any of the BMV Quiz encoded formats
 */
export function isEncodedQuizData(data: string): boolean {
  return data.startsWith("BMVQUIZ_ENCODED_") || 
         data.startsWith("BMVQUIZ_SIMPLE_") || 
         data.startsWith("BMVQUIZ_UTF8_");
}

/**
 * Safely converts an object to a JSON string with error handling
 * This function is used for reliable offline export
 */
export function safeStringify(obj: any, fallback: string = "{}"): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (error) {
    console.error("Error stringifying object:", error);
    return fallback;
  }
}
