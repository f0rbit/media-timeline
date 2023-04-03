"use client";
import { Customer, CustomerServer, Integration } from "@prisma/client";
import { FetchedCustomerData, getCustomerData } from "api/users";
import { Session } from "next-auth";
import React, { use, useEffect, useState } from "react";

// customer context
export const CustomerContext = React.createContext<{
	data: FetchedCustomerData;
	setData: React.Dispatch<React.SetStateAction<FetchedCustomerData>>;
}>({
	data: [],
	setData: () => {},
});

// customer provider
export const CustomerProvider = ({ children, data }: { children: React.ReactNode; data: FetchedCustomerData }) => {
	// const [customer, setCustomer] = React.useState<Customer | null>(null);
	const [value, setValue] = useState<FetchedCustomerData>(data);

	return (
		<CustomerContext.Provider
			value={{
				data: value,
				setData: setValue,
			}}
		>
			{children}
		</CustomerContext.Provider>
	);
};
