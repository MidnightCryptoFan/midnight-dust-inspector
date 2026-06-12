type AddressInputProps = {
  address: string
  validationMessage: string | null
  validationNote: string | null
  isLoading: boolean
  onAddressChange: (value: string) => void
  onSubmit: () => void
}

export function AddressInput({
  address,
  validationMessage,
  validationNote,
  isLoading,
  onAddressChange,
  onSubmit,
}: AddressInputProps) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-950 dark:text-slate-100"
          htmlFor="stake-address"
        >
          Cardano stake or payment address
        </label>
        <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Paste your Cardano stake address (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100">
            stake1…
          </code>
          ) or a full payment address (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100">
            addr1…
          </code>
          ) — the stake key is extracted automatically. Stake addresses are shown
          under{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Receive
          </span>{" "}
          or{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Account details
          </span>{" "}
          in your Cardano wallet.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="stake-address"
          className="min-h-12 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-950 outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50 dark:placeholder:text-slate-500"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          placeholder="stake1..."
          autoComplete="off"
          spellCheck={false}
          aria-describedby={
            validationMessage ? "stake-address-error" : undefined
          }
        />
        <button
          className="min-h-12 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          type="submit"
          disabled={isLoading}
        >
          {isLoading ? "Checking..." : "Check DUST status"}
        </button>
      </div>

      {validationNote ? (
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
          {validationNote}
        </p>
      ) : null}
      {validationMessage ? (
        <p
          className="text-sm font-medium text-red-700 dark:text-red-300"
          id="stake-address-error"
        >
          {validationMessage}
        </p>
      ) : null}
    </form>
  )
}
