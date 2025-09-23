export default function PendingPage() {
  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#0b1020",color:"#e2e8f0"}}>
      <div style={{background:"#121a2e",padding:24,borderRadius:12,border:"1px solid #1f2937",maxWidth:520}}>
        <h1 style={{marginTop:0}}>Awaiting Approval</h1>
        <p>Your account was created. An administrator must approve access before you can use the dashboard.</p>
      </div>
    </main>
  );
}
