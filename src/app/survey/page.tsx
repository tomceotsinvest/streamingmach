import { Suspense } from "react";
import SurveyApp from "./SurveyApp";
import "./survey.css";

export const metadata = { title: "Netflix viewing survey" };

export default function Page() {
  return <Suspense fallback={null}><SurveyApp /></Suspense>;
}
