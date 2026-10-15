# Demo Signup and Login UI

Use for portfolio mockups and visual prototypes that resemble account flows without real authentication.

## Implementation

- Use familiar email/password fields but label page/modal as demo and explain data is not sent or saved.
- Set form submit handler to `preventDefault()`. Show local simulated feedback; reset password and other inputs after completion.
- Do not store credentials in browser storage, log values, submit to an endpoint, or present fake provider sign-in as real OAuth.
- For genuine Gmail sign-in, use Google's official OAuth/OpenID Connect flow; never collect Google password in custom form.
- Provide close/Escape behavior, keyboard focus, accessible dialog semantics, responsive layout, and reduced-motion support.

## Verification Checklist

- Dialog starts closed; trigger opens it.
- Close button, backdrop, and Escape close it.
- Invalid fields remain blocked by browser validation.
- Valid submit stays on current page, shows clearly simulated feedback, and resets password field.
- No fetch/XHR, form action, storage write, or credential logging exists in demo handler.
