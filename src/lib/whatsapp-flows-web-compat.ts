/**
 * US-936: WhatsApp Flows Web Companion Compatibility Validator
 *
 * Validates that WhatsApp Flow JSON definitions render correctly on both
 * mobile and WhatsApp Web desktop companion (supported since Dec 2025).
 *
 * Checks for:
 *  - Fixed pixel widths/heights that break on wider desktop viewports
 *  - Mobile-only layout assumptions
 *  - ImageCarousel proper configuration for desktop navigation
 *  - Component compatibility with desktop rendering context
 */

export interface WebCompatIssue {
  screen: string;
  component: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface WebCompatResult {
  flowFile: string;
  compatible: boolean;
  issues: WebCompatIssue[];
  screensChecked: number;
  componentsChecked: number;
}

// Components known to be web-compatible in WhatsApp Flows v7.1+
const WEB_COMPATIBLE_COMPONENTS = new Set([
  'SingleColumnLayout',
  'Form',
  'TextHeading',
  'TextSubheading',
  'TextBody',
  'TextCaption',
  'TextInput',
  'TextArea',
  'DatePicker',
  'Dropdown',
  'RadioButtonsGroup',
  'CheckboxGroup',
  'OptIn',
  'EmbeddedLink',
  'Footer',
  'ImageCarousel',
  'Image',
]);

// Pixel-based property patterns that indicate mobile-only sizing
const PIXEL_WIDTH_PATTERN = /^\d+px$/;

// Properties that should not contain fixed pixel values
const SIZE_PROPERTIES = ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'];

/**
 * Validate a single WhatsApp Flow JSON definition for web companion compatibility.
 */
export function validateFlowWebCompat(
  flowJson: Record<string, any>,
  flowFile: string,
): WebCompatResult {
  const issues: WebCompatIssue[] = [];
  let componentsChecked = 0;

  const screens = flowJson.screens || [];

  for (const screen of screens) {
    const screenId = screen.id || 'UNKNOWN';

    // Check layout type
    const layout = screen.layout;
    if (!layout) {
      issues.push({
        screen: screenId,
        component: 'screen',
        severity: 'error',
        message: 'Screen has no layout defined',
      });
      continue;
    }

    if (layout.type !== 'SingleColumnLayout') {
      issues.push({
        screen: screenId,
        component: 'layout',
        severity: 'error',
        message: `Layout type "${layout.type}" may not render correctly on WhatsApp Web. Use SingleColumnLayout.`,
      });
    }

    // Recursively check all children for web compat issues
    const children = layout.children || [];
    for (const child of children) {
      componentsChecked += checkComponent(child, screenId, issues);
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');

  return {
    flowFile,
    compatible: !hasErrors,
    issues,
    screensChecked: screens.length,
    componentsChecked,
  };
}

/**
 * Recursively check a component and its children for web compat issues.
 * Returns the number of components checked.
 */
function checkComponent(
  component: Record<string, any>,
  screenId: string,
  issues: WebCompatIssue[],
): number {
  let count = 1;
  const type = component.type || 'unknown';

  // Check component type is known web-compatible
  if (!WEB_COMPATIBLE_COMPONENTS.has(type)) {
    issues.push({
      screen: screenId,
      component: type,
      severity: 'warning',
      message: `Component "${type}" may not be supported on WhatsApp Web. Verify rendering manually.`,
    });
  }

  // Check for fixed pixel dimensions in properties
  for (const prop of SIZE_PROPERTIES) {
    const value = component[prop];
    if (typeof value === 'string' && PIXEL_WIDTH_PATTERN.test(value)) {
      issues.push({
        screen: screenId,
        component: type,
        severity: 'error',
        message: `Fixed pixel ${prop} "${value}" will not adapt to WhatsApp Web desktop viewport. Use relative sizing or remove.`,
      });
    }
  }

  // ImageCarousel-specific checks
  if (type === 'ImageCarousel') {
    const aspectRatio = component['aspect-ratio'];
    if (aspectRatio && !['4:3', '16:9', '1:1'].includes(aspectRatio)) {
      issues.push({
        screen: screenId,
        component: type,
        severity: 'warning',
        message: `Unusual aspect ratio "${aspectRatio}" on ImageCarousel. Standard ratios (4:3, 16:9, 1:1) are recommended for consistent desktop rendering.`,
      });
    }
  }

  // TextInput max-length validation for desktop keyboards (can type faster)
  if (type === 'TextInput' || type === 'TextArea') {
    const maxLength = component['max-length'];
    if (maxLength && maxLength < 10) {
      issues.push({
        screen: screenId,
        component: `${type}[${component.name || ''}]`,
        severity: 'warning',
        message: `Very short max-length (${maxLength}) may frustrate desktop keyboard users.`,
      });
    }
  }

  // Recurse into children
  const children = component.children || [];
  for (const child of children) {
    count += checkComponent(child, screenId, issues);
  }

  return count;
}

/**
 * Validate that a data-exchange endpoint response is platform-agnostic.
 * The same response structure must work for both mobile and web companion.
 */
export function validateEndpointResponse(
  response: Record<string, any>,
  flowId: string,
): WebCompatIssue[] {
  const issues: WebCompatIssue[] = [];
  const screen = response.screen || 'UNKNOWN';

  // Response must have screen + data structure (same for mobile and web)
  if (!response.screen && !response.close_flow) {
    issues.push({
      screen,
      component: 'response',
      severity: 'error',
      message: 'Endpoint response missing "screen" field — required for both mobile and web rendering.',
    });
  }

  if (response.data) {
    // Check for platform-specific fields that should not exist
    const platformFields = ['mobile_only', 'desktop_only', 'platform', 'device_type'];
    for (const field of platformFields) {
      if (field in response.data) {
        issues.push({
          screen,
          component: 'response.data',
          severity: 'error',
          message: `Response contains platform-specific field "${field}". Flow responses must be platform-agnostic.`,
        });
      }
    }
  }

  return issues;
}
