import AddClient from "@/components/AddClient";
import Clients from "@/components/Clients";

export default async function ClientPage() {
	return (
		<section className="flex flex-col gap-2 w-full pl-2 pr-6">
			<div className="flex flex-row gap-2 items-center w-full h-10">
				<h2 className="font-bold text-xl h-10">Clients</h2>
				<div className="ml-auto">
					<AddClient />
				</div>
			</div>
			<Clients />
		</section>
	);
}
