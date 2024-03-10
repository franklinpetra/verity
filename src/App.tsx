import viteLogo from "./assets/vite.svg";
import reactLogo from "./assets/react.svg";
import createVerityLogo from "./assets/create-verity-logo-2.png";

function App() {
  return (
      <div className={"h-screen bg-[#f4f3f2] dark:bg-[#242424] flex flex-col justify-center"}>
        <div className={"flex p-4"}>
          <a href="https://vitejs.dev" target="_blank" className={"basis-1/3 flex"}>
            <img src={viteLogo} alt={"Vite logo"} />
          </a>
          <a href="https://github.com/cwalters162/create-verity" target="_blank" className={"basis-1/3"}>
            <img
                src={createVerityLogo}
                alt={"create-verity logo"}
            />
          </a>
          <a href="https://react.dev" target="_blank" className={"basis-1/3 flex"}>
            <img src={reactLogo} alt="React logo" />
          </a>
        </div>
        <div>
          <p className={"text-center text-4xl dark:text-[#44AA00] p-1"}>
            Time to begin
          </p>
        </div>
      </div>
  );
}

export default App;
