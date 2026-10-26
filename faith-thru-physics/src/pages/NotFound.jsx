import { Link } from "react-router-dom";
export default function NotFound() {
  return <div className="page-pad narrow"><h1 className="page-title">Nothing here</h1><p>This address doesn’t match a paper, claim or page. <Link to="/">Home</Link></p></div>;
}
