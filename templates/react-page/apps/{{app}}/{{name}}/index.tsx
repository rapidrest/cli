import React from "react";
{{#unless service}}
export async function fetchProps() {
    return {};
}

{{/unless}}
export default function {{className}}() {
    return <p>Add your page content here!</p>;
}