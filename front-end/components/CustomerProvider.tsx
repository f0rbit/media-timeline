"use client";
import { ServerCluster } from "@prisma/client";
import { FetchedCustomerData } from "api/users";
import React, { useState } from "react";

// customer context
export const CustomerContext = React.createContext<{
	data: FetchedCustomerData[];
	setData: React.Dispatch<React.SetStateAction<FetchedCustomerData[]>>;
	clusters: ServerCluster[];
}>({
	data: [],
	setData: () => {},
	clusters: [],
});

// customer provider
export const CustomerProvider = ({ children, data, clusters }: { children: React.ReactNode; data: FetchedCustomerData[]; clusters: ServerCluster[] }) => {
	// const [customer, setCustomer] = React.useState<Customer | null>(null);
	const [value, setValue] = useState<FetchedCustomerData[]>(data);

	return (
		<CustomerContext.Provider
			value={{
				data: value,
				setData: setValue,
				clusters: clusters,
			}}
		>
			{children}
		</CustomerContext.Provider>
	);
};
