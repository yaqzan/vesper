// API client. Single origin — paths are relative, so the same server that
// served the app handles these requests (no CORS, no base URL). Access is
// restricted at the network layer (Tailscale) rather than by an app-level key.

async function asError(response, fallback) {
  let detail = fallback
  try {
    const body = await response.json()
    if (body && body.detail) detail = body.detail
  } catch {
    // non-JSON error body — keep the fallback
  }
  return new Error(`${detail} (${response.status})`)
}

/** Checks that the backend is reachable (over Tailscale). Throws if not. */
export async function checkHealth() {
  const response = await fetch('/health')
  if (!response.ok) throw new Error(`Server error (${response.status})`)
  return response.json()
}

// Abort only when an upload stops making progress. A fixed total timeout
// would kill a long recording on a slow uplink that is still moving.
const UPLOAD_STALL_MS = 45_000

/**
 * Upload a recording for transcription. XHR rather than fetch: fetch has no
 * upload progress, and the upload tray shows a real percentage.
 * @param {(fraction: number) => void} [onProgress] 0..1 as bytes go out
 * @returns {Promise<{id,date,transcript,duration_seconds,word_count,created_at}>}
 */
export function uploadAudio(blob, mimeType, filename, localDate, onProgress) {
  const form = new FormData()
  form.append('audio', blob, filename)
  if (localDate) form.append('local_date', localDate)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let stallTimer = null
    let stalled = false
    const armStall = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        stalled = true
        xhr.abort()
      }, UPLOAD_STALL_MS)
    }

    xhr.upload.onprogress = (e) => {
      armStall()
      if (onProgress && e.lengthComputable && e.total > 0) {
        onProgress(e.loaded / e.total)
      }
    }
    xhr.upload.onload = armStall // body sent; now waiting on the response

    xhr.onload = () => {
      clearTimeout(stallTimer)
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // non-JSON body — handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body)
      } else {
        const detail = (body && body.detail) || 'Upload failed'
        reject(new Error(`${detail} (${xhr.status})`))
      }
    }
    xhr.onerror = () => {
      clearTimeout(stallTimer)
      reject(new Error('Network error — will retry'))
    }
    xhr.onabort = () => {
      clearTimeout(stallTimer)
      reject(new Error(stalled ? 'Upload stalled — will retry' : 'Upload cancelled'))
    }

    xhr.open('POST', '/api/transcribe')
    armStall()
    xhr.send(form)
  })
}

export async function fetchTranscripts(date) {
  const url = date
    ? `/api/transcripts?date=${encodeURIComponent(date)}`
    : '/api/transcripts'
  const response = await fetch(url)
  if (!response.ok) throw await asError(response, 'Could not load entries')
  return response.json()
}

export async function fetchCalendar() {
  const response = await fetch('/api/calendar')
  if (!response.ok) throw await asError(response, 'Could not load calendar')
  return response.json()
}

/** Replace an entry's transcript text. Returns {id, transcript, word_count}. */
export async function updateTranscript(id, transcript) {
  const response = await fetch(`/api/transcripts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  })
  if (!response.ok) throw await asError(response, 'Could not save changes')
  return response.json()
}

export async function deleteTranscript(id) {
  const response = await fetch(`/api/transcripts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw await asError(response, 'Could not delete entry')
  return response.json()
}
