import React from "react";
import Pet from "../src/models/Pet.js";

export default function PetsPage({ pets }: { pets?: Pet[] }) {
    return <ul>{(pets ?? []).map((p) => <li key={p.uid}>{p.name}</li>)}</ul>;
}
