"use client";
export function DeleteTrackControl({trackId,filename}:{trackId:string;filename:string}) {
  return <form action="/api/v2/admin/content" method="post" className="inline-form">
    <input type="hidden" name="operation" value="delete-track" />
    <input type="hidden" name="trackId" value={trackId} />
    <button type="button" className="btn btn-sm" style={{color:"#d98282"}}
      onClick={event=>{if(window.confirm(`Permanently delete "${filename}" and its owned media file? This cannot be undone.`))event.currentTarget.form?.requestSubmit();}}>Delete track</button>
  </form>;
}
