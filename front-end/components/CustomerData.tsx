"use client";

import { useContext } from "react";
import { CustomerContext } from "./CustomerProvider";

export default function CustomerData() {
	const { data } = useContext(CustomerContext);
	return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
