const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzsQXobFjEBDN_UG054chyGMr60_UPLSjR0AQqIp4-KbfwRDsjxw11j3corErgoNfsL1g/exec';

export async function onRequestPost(context) {
  try {
    const incoming = await context.request.json();
    const backendUrl = context.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;

    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify(incoming),
      redirect: 'follow'
    });

    const text = await backendResponse.text();

    return new Response(text, {
      status: backendResponse.ok ? 200 : backendResponse.status,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error?.message || 'Błąd bramki API.'
    }, { status: 500 });
  }
}

export function onRequestGet() {
  return Response.json({
    ok: true,
    service: 'SelfStorage API gateway'
  });
}
